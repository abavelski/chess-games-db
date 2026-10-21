package dev.cb;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class BookRecordTest {
 @Test void unicodeEscapesAndBom() {
  var h = BookRecord.headers("\uFEFF[White \"Белые\"]\r\n[Event \"A \\\"quote\\\"\"]\r\n\r\n1. e4 *");
  assertEquals("Белые", h.get("White"));
  assertEquals("A \"quote\"", h.get("Event"));
 }
}
