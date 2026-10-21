package dev.cb;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import com.github.luben.zstd.ZstdCompressCtx;
import se.yarin.chess.GameModel;
import se.yarin.chess.pgn.PgnExporter;
import se.yarin.chess.pgn.PgnFormatOptions;
import se.yarin.morphy.Database;
import se.yarin.morphy.DatabaseMode;
import se.yarin.morphy.DatabaseReadTransaction;
import se.yarin.morphy.games.ExtendedGameHeaderStorage;
import se.yarin.morphy.util.CBUtil;
import java.io.StringWriter;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Protocol 1. All diagnostics go to stderr; terminal summary proves completion. */
public final class UnifiedExport {
 private static final JsonFactory JSON = new JsonFactory().disable(JsonGenerator.Feature.AUTO_CLOSE_TARGET);
 public static void main(String[] args) throws Exception {
  if (args.length != 6) throw new IllegalArgumentException("Expected staged.cbh count min-annotations min-year languages charset");
  Path path = Path.of(args[0]);
  if (Boolean.getBoolean("dev.cb.recoverExtendedHeaders")) ExtendedGameHeaderStorage.upgrade(path.toFile());
  export(path, Integer.parseInt(args[1]), Integer.parseInt(args[2]), Integer.parseInt(args[3]), args[4], args[5], System.out);
 }
 static void skip(OutputStream out, int id, String reason) throws Exception {
  var buffer = new StringWriter();
  try (var j = JSON.createGenerator(buffer)) {
   j.writeStartObject(); j.writeNumberField("protocol",1); j.writeStringField("type","skip");
   j.writeNumberField("recordId",id); j.writeStringField("reason",reason); j.writeEndObject();
  }
  out.write((buffer+"\n").getBytes(StandardCharsets.UTF_8));
 }
 static int export(Path path, int count, int annotations, int year, String languages, String charset, OutputStream out) throws Exception {
  if (count < 0 || annotations < 0 || year < 0 || year > 9999) throw new IllegalArgumentException("Invalid extraction limits");
  var language = AnnotationLanguages.parse(languages);
  var encoding = Charset.forName(charset); CBUtil.cbDefaultSingleByteCharset = encoding;
  var exporter = new PgnExporter(PgnFormatOptions.DEFAULT, ArchivePgnAnnotations::toPgn);
  int scanned=0, exported=0, skipped=0; boolean subset=false;
  try (var db=Database.open(path.toFile(), DatabaseMode.READ_ONLY); var tx=new DatabaseReadTransaction(db); var compressor=new ZstdCompressCtx()) {
   compressor.setLevel(3).setChecksum(true).setContentSize(true);
   for (var game:tx.iterable()) {
    if (count > 0 && exported >= count) { subset=true; break; }
    scanned++;
    if (game.guidingText()) { skip(out,game.id(),"guiding-text"); skipped++; continue; }
    if (game.playedDate().year() < year) { skip(out,game.id(),"minimum-year"); skipped++; continue; }
    try {
     // getModel() silently catches decoding errors; use the strict decoder.
     var blob=game.getMovesBlob(); byte[] bytes=new byte[blob.remaining()]; blob.get(bytes);
     var moves=db.moveRepository().moveSerializer().deserializeMoves(ByteBuffer.wrap(bytes),true,game.id());
     var model=new GameModel(game.getGameHeaderModel(),moves);
     db.annotationRepository().getAnnotations(model.moves(),game.getAnnotationOffset());
     BookText.decodeGameText(db,game,model,encoding);
     if (moves.countPly(false)==0) { skip(out,game.id(),"empty-standalone-position"); skipped++; continue; }
     if (moves.countAnnotations()<annotations) { skip(out,game.id(),"minimum-annotations"); skipped++; continue; }
     if (!language.filter(model)) { skip(out,game.id(),"comment-language"); skipped++; continue; }
     BookRecord.markRecord(model,"game",game.id(),game.trainingMagnitude(),game.deleted());
     var pgn=new StringWriter(); exporter.exportGame(model,pgn);
     byte[] plain=pgn.toString().getBytes(StandardCharsets.UTF_8);
     var buffer=new StringWriter();
     try (var j=JSON.createGenerator(buffer)) {
      j.writeStartObject(); j.writeNumberField("protocol",1); j.writeStringField("type","record");
      j.writeNumberField("recordId",game.id()); j.writeNumberField("sequence",scanned);
      j.writeStringField("key",Integer.toString(game.id()));
      j.writeNumberField("movesOffset",game.getMovesOffset()); j.writeNumberField("annotationsOffset",game.getAnnotationOffset());
      j.writeBooleanField("sourceDeleted",game.deleted()); j.writeNumberField("trainingMagnitude",game.trainingMagnitude());
      j.writeStringField("pgn_sha256",HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(plain)));
      j.writeBinaryField("pgn_zstd_base64",compressor.compress(plain));
      j.writeObjectFieldStart("headers");
      for (var h:BookRecord.headers(pgn.toString()).entrySet()) j.writeStringField(h.getKey(),h.getValue());
      j.writeEndObject(); j.writeEndObject();
     }
     out.write((buffer+"\n").getBytes(StandardCharsets.UTF_8)); exported++;
    } catch (Exception e) { throw new IllegalStateException("Could not fully decode record "+game.id(),e); }
   }
  }
  var summary=new StringWriter();
  try(var j=JSON.createGenerator(summary)) {
   j.writeStartObject(); j.writeNumberField("protocol",1); j.writeStringField("type","summary");
   j.writeNumberField("scanned",scanned); j.writeNumberField("exported",exported); j.writeNumberField("skipped",skipped);
   j.writeStringField("coverage",subset?"intentional-subset":"full"); j.writeEndObject();
  }
  out.write((summary+"\n").getBytes(StandardCharsets.UTF_8)); out.flush(); return exported;
 }
}
