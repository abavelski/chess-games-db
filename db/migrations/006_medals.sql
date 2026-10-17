ALTER TABLE games ADD COLUMN medal_count INTEGER CHECK (medal_count >= 0);
ALTER TABLE games ADD COLUMN has_medals INTEGER GENERATED ALWAYS AS (medal_count > 0) VIRTUAL;
ALTER TABLE games ADD COLUMN has_study_markers INTEGER GENERATED ALWAYS AS (
  CASE WHEN critical_position_count > 0 OR medal_count > 0 THEN 1
       WHEN critical_position_count IS NOT NULL AND medal_count IS NOT NULL THEN 0 END
) VIRTUAL;
CREATE INDEX idx_games_study_markers ON games(has_study_markers, is_deleted, record_kind);
CREATE TRIGGER games_medals_changed AFTER UPDATE OF pgn_sha256 ON games
WHEN NEW.pgn_sha256 != OLD.pgn_sha256
BEGIN
  UPDATE games SET medal_count = NULL WHERE id = NEW.id;
END;
