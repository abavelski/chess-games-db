package dev.cb;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import se.yarin.chess.pgn.PgnParser;
import se.yarin.morphy.Database;
import se.yarin.morphy.games.annotations.AnnotationConverter;
import java.nio.file.Path;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;
class UnifiedExportTest {
 @TempDir Path directory;
 @Test void includesUnknownPlayersAndSetupAndPreservesLanguageAnnotations() throws Exception {
  var parser=new PgnParser(AnnotationConverter.getRoundTripConverter()::convertToChessBase);
  String required="[Event \"Test\"]\n[Site \"Here\"]\n[Date \"2020.01.01\"]\n[Round \"1\"]\n[White \"?\"]\n[Black \"?\"]\n[Result \"*\"]\n";
  var ordinary=parser.parseGame(required+"[White \"?\"]\n[Black \"?\"]\n\n1. e4 {[%post:ENG English]} e5 (1... c5 $1) *");
  var setup=parser.parseGame(required+"[SetUp \"1\"]\n[FEN \"8/8/8/8/8/4k3/8/4K3 w - - 0 1\"]\n\n1. Kf1 *");
  Path path=directory.resolve("fixture.cbh");
  try(var db=Database.create(path.toFile())) {db.addGame(ordinary);db.addGame(setup);}
  var out=new ByteArrayOutputStream();
  assertEquals(2,UnifiedExport.export(path,0,0,0,"all","windows-1251",out));
  String text=out.toString(StandardCharsets.UTF_8);
  assertTrue(text.contains("\"coverage\":\"full\"")); assertTrue(text.contains("\"key\":\"2\""));
  out.reset(); assertEquals(1,UnifiedExport.export(path,0,0,0,"en","windows-1251",out));
  assertTrue(out.toString(StandardCharsets.UTF_8).contains("comment-language"));
 }
}
