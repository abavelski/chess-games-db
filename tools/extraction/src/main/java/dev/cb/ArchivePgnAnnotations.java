package dev.cb;

import se.yarin.chess.Player;
import se.yarin.chess.annotations.Annotations;
import se.yarin.chess.annotations.CommentaryAfterMoveAnnotation;
import se.yarin.chess.annotations.CommentaryBeforeMoveAnnotation;
import se.yarin.morphy.games.annotations.AnnotationConverter;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Pattern;

/** Preserve literal PGN braces inside commentary without allowing them to become moves. */
public final class ArchivePgnAnnotations {
    private static final Pattern ORIGINAL = Pattern.compile("\\[%cbtext ([A-Za-z0-9+/=]+)\\]$");
    private ArchivePgnAnnotations() {}

    public static void toPgn(Annotations annotations, Player lastMoveBy) {
        AnnotationConverter.getRoundTripConverter().convertToPgn(annotations, lastMoveBy);
        transformComments(annotations, true);
    }

    public static void toChessBase(Annotations annotations, Player lastMoveBy) {
        transformComments(annotations, false);
        AnnotationConverter.getRoundTripConverter().convertToChessBase(annotations, lastMoveBy);
    }

    private static void transformComments(Annotations annotations, boolean encode) {
        for (int i = 0; i < annotations.size(); i++) {
            var annotation = annotations.get(i);
            if (annotation instanceof CommentaryBeforeMoveAnnotation before) {
                annotations.set(i, new CommentaryBeforeMoveAnnotation(encode ? safeComment(before.getCommentary()) : originalComment(before.getCommentary())));
            } else if (annotation instanceof CommentaryAfterMoveAnnotation after) {
                annotations.set(i, new CommentaryAfterMoveAnnotation(encode ? safeComment(after.getCommentary()) : originalComment(after.getCommentary())));
            }
        }
    }

    static String safeComment(String text) {
        if (!text.contains("{") && !text.contains("}")) return text;
        // A readable preview uses full-width braces; the directive retains exact UTF-8.
        return text.replace('{', '｛').replace('}', '｝') + " [%cbtext "
                + Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8)) + "]";
    }

    static String originalComment(String text) {
        var matcher = ORIGINAL.matcher(text);
        return matcher.find() ? new String(Base64.getDecoder().decode(matcher.group(1)), StandardCharsets.UTF_8) : text;
    }
}
