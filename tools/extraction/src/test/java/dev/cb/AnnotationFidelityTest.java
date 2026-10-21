package dev.cb;

import com.fasterxml.jackson.core.JsonFactory;
import com.github.luben.zstd.Zstd;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import se.yarin.chess.GameModel;
import se.yarin.chess.Move;
import se.yarin.chess.Position;
import se.yarin.chess.pgn.PgnParser;
import se.yarin.morphy.Database;
import se.yarin.morphy.games.annotations.AnnotationConverter;
import se.yarin.morphy.entities.Nation;
import se.yarin.morphy.games.annotations.ImmutableTextAfterMoveAnnotation;
import se.yarin.morphy.games.annotations.ImmutableTextBeforeMoveAnnotation;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

class AnnotationFidelityTest {
    @TempDir Path directory;
    private GameModel model(String name, int year, boolean annotated) throws Exception {
        return new PgnParser(AnnotationConverter.getRoundTripConverter()::convertToChessBase).parseGame(
                "[Event \"Test\"]\n[Site \"Here\"]\n[Date \"" + year + ".01.01\"]\n[Round \"1\"]\n"
                + "[White \"" + name + "\"]\n[Black \"Black\"]\n[Result \"*\"]\n[Annotator \"Author, A\"]\n\n"
                + "1. e4 " + (annotated ? "{[%post:ENG Explanation]} " : "") + "e5 (1... c5 $1 2. Nf3) 2. Nf3 Nc6 *");
    }

    @Test void matchesVariationCommentsWithoutRemovingOtherLanguagesAndDoesNotGuessUntaggedText() throws Exception {
        var game = model("Multilingual", 2020, false);
        game.moves().root().getAnnotations().add(ImmutableTextAfterMoveAnnotation.builder()
                .text("Deutsch").language(Nation.GERMANY).build());
        var variation = game.moves().getAllNodes().stream().filter(node -> !node.isRoot()).reduce((a,b) -> b).orElseThrow();
        variation.getAnnotations().add(ImmutableTextBeforeMoveAnnotation.builder()
                .text("English").language(Nation.ENGLAND).build());
        assertTrue(AnnotationLanguages.parse("ru,en").matches(game));
        assertTrue(AnnotationLanguages.parse(" EN , ru,EN ").matches(game));
        assertTrue(AnnotationLanguages.parse("ENG").matches(game));
        assertTrue(AnnotationLanguages.parse("de").matches(game));
        assertFalse(AnnotationLanguages.parse("ru").matches(game));
        assertEquals(1, variation.getAnnotations().size());
        var untagged = model("Untagged", 2020, false);
        untagged.moves().root().getAnnotations().add(ImmutableTextAfterMoveAnnotation.builder().text("English text").build());
        assertFalse(AnnotationLanguages.parse("ru,en").matches(untagged));
        assertTrue(AnnotationLanguages.parse("untagged").matches(untagged));
        assertTrue(AnnotationLanguages.parse("en,untagged").matches(untagged));
        assertFalse(AnnotationLanguages.parse("untagged").matches(model("Nags only", 2020, false)));
        assertTrue(AnnotationLanguages.parse("all").matches(model("Nags only", 2020, false)));
        for (String invalid : new String[]{"", "en,", "xx", "en,all", "russian"})
            assertThrows(IllegalArgumentException.class, () -> AnnotationLanguages.parse(invalid));
    }

    private GameModel multilingual() throws Exception {
        var game = model("Multilingual", 2020, true);
        game.moves().root().getAnnotations().add(ImmutableTextAfterMoveAnnotation.builder()
                .text("GermanOnly").language(Nation.GERMANY).build());
        game.moves().root().getAnnotations().add(ImmutableTextAfterMoveAnnotation.builder()
                .text("UntaggedOnly").build());
        var variation = game.moves().root().children().getFirst().children().get(1);
        variation.getAnnotations().add(ImmutableTextBeforeMoveAnnotation.builder()
                .text("RussianOnly").language(Nation.RUSSIA).build());
        return game;
    }

    private String firstPgn(ByteArrayOutputStream output) throws Exception {
        try (var json = new JsonFactory().createParser(output.toByteArray())) {
            while (json.nextToken() != null) {
                if (json.currentToken().isScalarValue() && "pgn_zstd_base64".equals(json.currentName())) {
                    byte[] compressed = Base64.getDecoder().decode(json.getText());
                    return new String(Zstd.decompress(compressed, (int) Zstd.getFrameContentSize(compressed)), StandardCharsets.UTF_8);
                }
            }
        }
        throw new AssertionError("No PGN exported");
    }

    @Test void exportsOneLanguagePerGameInPriorityOrderAndPreservesAllWhenOmitted() throws Exception {
        Path input = directory.resolve("priority.cbh");
        try (var db = Database.create(input.toFile())) { db.addGame(multilingual()); }
        for (String languages : new String[]{"ru,en", "en,ru", "untagged,en", "all"}) {
            var output = new ByteArrayOutputStream();
            assertEquals(1, UnifiedExport.export(input, 1, 0, 0, languages, "windows-1251", output));
            String pgn = firstPgn(output);
            assertEquals(languages.equals("ru,en") || languages.equals("all"), pgn.contains("RussianOnly"));
            assertEquals(languages.equals("en,ru") || languages.equals("all"), pgn.contains("Explanation"));
            assertEquals(languages.equals("untagged,en") || languages.equals("all"), pgn.contains("UntaggedOnly"));
            assertEquals(languages.equals("all"), pgn.contains("GermanOnly"));
            assertTrue(pgn.contains("$1")); // Nontext annotations and variation moves survive.
            assertTrue(pgn.contains("c5"));
            assertEquals(6, new PgnParser().parseGame(pgn).moves().countPly(true));
        }
        var output = new ByteArrayOutputStream();
        assertEquals(1, UnifiedExport.export(input, 1, 0, 0, "all", "windows-1251", output));
        String original = firstPgn(output);
        for (String text : new String[]{"RussianOnly", "Explanation", "UntaggedOnly", "GermanOnly"})
            assertTrue(original.contains(text)); // Filtered exports never alter the source database.
    }

    @Test void fallsBackOncePerGameAndRemovesUntaggedComments() throws Exception {
        var game = model("English fallback", 2020, true);
        game.moves().root().getAnnotations().add(ImmutableTextAfterMoveAnnotation.builder()
                .text("Deutsch").language(Nation.GERMANY).build());
        game.moves().root().getAnnotations().add(ImmutableTextAfterMoveAnnotation.builder().text("Unknown language").build());
        assertTrue(AnnotationLanguages.parse("ru,en").filter(game));
        assertFalse(AnnotationLanguages.parse("de").matches(game));
        assertFalse(AnnotationLanguages.parse("untagged").matches(game));
        assertTrue(AnnotationLanguages.parse("en").matches(game));
    }
}
