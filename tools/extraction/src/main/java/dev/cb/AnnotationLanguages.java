package dev.cb;

import se.yarin.chess.GameModel;
import se.yarin.chess.annotations.Annotation;
import se.yarin.chess.annotations.CommentaryAfterMoveAnnotation;
import se.yarin.chess.annotations.CommentaryBeforeMoveAnnotation;
import se.yarin.morphy.entities.Nation;
import se.yarin.morphy.games.annotations.TextAfterMoveAnnotation;
import se.yarin.morphy.games.annotations.TextBeforeMoveAnnotation;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Match explicit ChessBase language tags; never guess the language of untagged prose. */
final class AnnotationLanguages {
    private static final Map<String, Nation> ISO = Map.ofEntries(
            Map.entry("ru", Nation.RUSSIA), Map.entry("en", Nation.ENGLAND),
            Map.entry("de", Nation.GERMANY), Map.entry("fr", Nation.FRANCE),
            Map.entry("es", Nation.SPAIN), Map.entry("it", Nation.ITALY),
            Map.entry("pt", Nation.PORTUGAL), Map.entry("nl", Nation.NETHERLANDS),
            Map.entry("pl", Nation.POLAND), Map.entry("cs", Nation.CZECH_REPUBLIC),
            Map.entry("hu", Nation.HUNGARY), Map.entry("sv", Nation.SWEDEN),
            Map.entry("uk", Nation.UKRAINE), Map.entry("zh", Nation.CHINA));

    private final List<Nation> allowed;
    private final boolean all;

    private AnnotationLanguages(Set<Nation> allowed, boolean all) {
        this.allowed = List.copyOf(allowed);
        this.all = all;
    }

    static AnnotationLanguages parse(String value) {
        if (value.trim().equalsIgnoreCase("all")) return new AnnotationLanguages(Set.of(), true);
        Set<Nation> allowed = new LinkedHashSet<>();
        for (String part : value.split(",", -1)) {
            String code = part.trim().toLowerCase(Locale.ROOT);
            if (code.equals("untagged")) { allowed.add(Nation.NONE); continue; }
            Nation nation = ISO.get(code);
            // Also accept ChessBase's three-letter IOC tags (ENG, RUS, GER, ...).
            if (nation == null && code.matches("[a-z]{3}")) nation = Nation.fromIOC(code);
            if (nation == null || nation == Nation.NONE)
                throw new IllegalArgumentException("Unknown annotation language: " + part
                        + "; use ru,en,de,fr,es,it,pt,nl,pl,cs,hu,sv,uk,zh, ChessBase IOC tags, untagged, or all");
            allowed.add(nation);
        }
        return new AnnotationLanguages(allowed, false);
    }

    boolean matches(GameModel model) {
        if (all) return true;
        return preferredLanguage(model) != null;
    }

    /** Choose once per game, then retain only that language throughout its entire tree. */
    boolean filter(GameModel model) {
        if (all) return true;
        Nation selected = preferredLanguage(model);
        if (selected == null) return false;
        for (var node : model.moves().getAllNodes()) {
            node.getAnnotations().removeIf(annotation -> {
                Nation language = language(annotation);
                return language != null && language != selected;
            });
        }
        return true;
    }

    private Nation preferredLanguage(GameModel model) {
        Set<Nation> present = new HashSet<>();
        for (var node : model.moves().getAllNodes()) {
            for (var annotation : node.getAnnotations()) {
                String text = switch (annotation) {
                    case TextAfterMoveAnnotation after -> after.text();
                    case TextBeforeMoveAnnotation before -> before.text();
                    case CommentaryAfterMoveAnnotation after -> after.getCommentary();
                    case CommentaryBeforeMoveAnnotation before -> before.getCommentary();
                    default -> "";
                };
                if (!text.isBlank()) present.add(language(annotation));
            }
        }
        return allowed.stream().filter(present::contains).findFirst().orElse(null);
    }

    private static Nation language(Annotation annotation) {
        return switch (annotation) {
            case TextAfterMoveAnnotation after -> after.language();
            case TextBeforeMoveAnnotation before -> before.language();
            case CommentaryAfterMoveAnnotation ignored -> Nation.NONE;
            case CommentaryBeforeMoveAnnotation ignored -> Nation.NONE;
            default -> null;
        };
    }
}
