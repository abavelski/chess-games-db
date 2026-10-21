package dev.cb;
import se.yarin.chess.GameModel;
import se.yarin.morphy.games.annotations.TrainingAnnotation;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.regex.Pattern;
/** PGN metadata helpers, extracted from the original book adapter. */
final class BookRecord {
    private static final Pattern TAG = Pattern.compile(
            "\\[([A-Za-z0-9_]+)\\s+\\\"((?:\\\\.|[^\\\"\\\\])*)\\\"\\s*\\]");
    static void markRecord(GameModel model, String kind, int recordId, int trainingMagnitude, boolean deleted) {
        markRecord(model, kind, recordId, trainingMagnitude, trainingMagnitude > 0, deleted);
    }

    static void markRecord(GameModel model, String kind, int recordId, int trainingMagnitude, boolean training, boolean deleted) {
        training |= model.moves().getAllNodes().stream()
                .anyMatch(node -> node.getAnnotations().stream().anyMatch(a -> a instanceof TrainingAnnotation));
        model.header().setField("RecordKind", kind);
        model.header().setField("RecordType", kind);
        model.header().setField("ChessBaseRecordId", Integer.toString(recordId));
        model.header().setField("Training", training ? "1" : "0");
        model.header().setField("TrainingMagnitude", Integer.toString(Math.max(0, trainingMagnitude)));
        model.header().setField("SourceDeleted", deleted ? "1" : "0");
    }

    static Map<String, String> headers(String pgn) {
        var matcher = TAG.matcher(pgn);
        Map<String, String> headers = new LinkedHashMap<>();
        int position = pgn.startsWith("\uFEFF") ? 1 : 0;
        while (position < pgn.length()) {
            while (position < pgn.length() && Character.isWhitespace(pgn.charAt(position))) position++;
            matcher.region(position, pgn.length());
            if (!matcher.lookingAt()) break;
            headers.put(matcher.group(1), matcher.group(2).replaceAll("\\\\(.)", "$1"));
            position = matcher.end();
        }
        return headers;
    }

}
