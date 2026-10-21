package dev.cb;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.JsonGenerator;
import se.yarin.chess.GameModel;
import se.yarin.chess.pgn.PgnExporter;
import se.yarin.chess.pgn.PgnFormatOptions;
import se.yarin.morphy.Database;
import se.yarin.morphy.DatabaseMode;
import se.yarin.morphy.DatabaseReadTransaction;
import se.yarin.morphy.Game;
import se.yarin.morphy.games.annotations.AnnotationConverter;
import se.yarin.morphy.games.annotations.ImmutableTextAfterMoveAnnotation;
import se.yarin.morphy.games.annotations.ImmutableTextBeforeMoveAnnotation;
import se.yarin.morphy.games.annotations.TextAfterMoveAnnotation;
import se.yarin.morphy.games.annotations.TextBeforeMoveAnnotation;
import se.yarin.morphy.text.TextContentsModel;
import se.yarin.morphy.text.TextLanguage;
import se.yarin.morphy.util.CBUtil;
import se.yarin.util.ByteBufferUtil;

import java.io.BufferedWriter;
import java.io.StringWriter;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;

/** Legacy text decoding extracted from BookExtract. */
final class BookText {
    static void decodeGameText(Database database, Game game, GameModel model, Charset charset) {
        model.header().setWhite(playerName(database.playerIndex().getRaw(game.whitePlayerId()), charset));
        model.header().setBlack(playerName(database.playerIndex().getRaw(game.blackPlayerId()), charset));
        ByteBuffer tournament = ByteBuffer.wrap(database.tournamentIndex().getRaw(game.tournamentId()));
        model.header().setEvent(readText(tournament, 40, charset));
        model.header().setEventSite(readText(tournament, 30, charset));
        model.header().setAnnotator(readText(ByteBuffer.wrap(
                database.annotatorIndex().getRaw(game.annotatorId())), 45, charset));
        ByteBuffer source = ByteBuffer.wrap(database.sourceIndex().getRaw(game.sourceId()));
        model.header().setSourceTitle(readText(source, 25, charset));
        model.header().setSource(readText(source, 16, charset));
        if (game.getAnnotationOffset() == 0) return;

        ByteBuffer raw = game.getAnnotationsBlob().duplicate().order(ByteOrder.BIG_ENDIAN);
        raw.position(7);
        int count = ByteBufferUtil.getUnsigned24BitB(raw) - 1;
        raw.getInt(); // Total blob size.
        var nodes = model.moves().getAllNodes();
        int[] annotationIndexes = new int[nodes.size()];
        for (int i = 0; i < count; i++) {
            int nodeIndex = ByteBufferUtil.getSigned24BitB(raw) + 1;
            int type = Byte.toUnsignedInt(raw.get());
            int length = raw.getShort() - 6;
            if (length < 0 || length > raw.remaining()) {
                throw new IllegalArgumentException("Invalid annotation length " + length);
            }
            int end = raw.position() + length;
            if (nodeIndex >= 0 && nodeIndex < nodes.size()) {
                var annotations = nodes.get(nodeIndex).getAnnotations();
                int index = annotationIndexes[nodeIndex]++;
                var original = annotations.get(index);
                if (type == 0x02 && original instanceof TextAfterMoveAnnotation text) {
                    raw.position(raw.position() + 2); // Unknown byte and language ID.
                    annotations.set(index, ImmutableTextAfterMoveAnnotation.builder().from(text)
                            .text(readText(raw, length - 2, charset)).build());
                } else if (type == 0x82 && original instanceof TextBeforeMoveAnnotation text) {
                    raw.position(raw.position() + 2);
                    annotations.set(index, ImmutableTextBeforeMoveAnnotation.builder().from(text)
                            .text(readText(raw, length - 2, charset)).build());
                }
            }
            raw.position(end);
        }
    }

    private static String playerName(byte[] bytes, Charset charset) {
        ByteBuffer raw = ByteBuffer.wrap(bytes);
        String last = readText(raw, 30, charset);
        String first = readText(raw, 20, charset);
        return first.isEmpty() ? last : last + ", " + first;
    }

    private static String readText(ByteBuffer raw, int length, Charset charset) {
        if (length < 0 || length > raw.remaining()) {
            throw new IllegalArgumentException("Invalid text length " + length);
        }
        byte[] bytes = new byte[length];
        raw.get(bytes);
        int end = 0;
        while (end < bytes.length && bytes[end] != 0) end++;
        return new String(bytes, 0, end, charset);
    }

}
