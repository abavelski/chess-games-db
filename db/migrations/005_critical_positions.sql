-- NULL means not indexed yet, rather than incorrectly claiming no markers.
ALTER TABLE games ADD COLUMN critical_position_count INTEGER CHECK (critical_position_count >= 0);
ALTER TABLE games ADD COLUMN has_critical_positions INTEGER GENERATED ALWAYS AS (critical_position_count > 0) VIRTUAL;
CREATE INDEX idx_games_critical_positions ON games(has_critical_positions, is_deleted, record_kind);
CREATE TRIGGER games_critical_positions_changed AFTER UPDATE OF pgn_sha256 ON games
WHEN NEW.pgn_sha256 != OLD.pgn_sha256
BEGIN
  UPDATE games SET critical_position_count = NULL WHERE id = NEW.id;
END;
