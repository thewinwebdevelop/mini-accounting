import unittest

from substitute_receipt_pdf import baht_text, thai_date


class BahtTextTests(unittest.TestCase):
    def test_zero(self):
        self.assertEqual(baht_text("0"), "ศูนย์บาทถ้วน")

    def test_small_numbers(self):
        self.assertEqual(baht_text("1"), "หนึ่งบาทถ้วน")
        self.assertEqual(baht_text("10"), "สิบบาทถ้วน")
        self.assertEqual(baht_text("11"), "สิบเอ็ดบาทถ้วน")
        self.assertEqual(baht_text("20"), "ยี่สิบบาทถ้วน")
        self.assertEqual(baht_text("21"), "ยี่สิบเอ็ดบาทถ้วน")

    def test_hundreds(self):
        self.assertEqual(baht_text("100"), "หนึ่งร้อยบาทถ้วน")
        self.assertEqual(baht_text("101"), "หนึ่งร้อยเอ็ดบาทถ้วน")

    def test_millions(self):
        self.assertEqual(baht_text("1000000"), "หนึ่งล้านบาทถ้วน")
        self.assertEqual(
            baht_text("1234567.89"),
            "หนึ่งล้านสองแสนสามหมื่นสี่พันห้าร้อยหกสิบเจ็ดบาทแปดสิบเก้าสตางค์",
        )

    def test_satang(self):
        self.assertEqual(baht_text("0.25"), "ศูนย์บาทยี่สิบห้าสตางค์")

    def test_negative(self):
        self.assertEqual(baht_text("-50"), "ลบห้าสิบบาทถ้วน")


class ThaiDateTests(unittest.TestCase):
    def test_valid_date(self):
        self.assertEqual(thai_date("2026-09-05"), "5 กันยายน 2569")

    def test_empty_falls_back(self):
        self.assertEqual(thai_date(""), "-")
        self.assertEqual(thai_date(None), "-")

    def test_unparseable_returns_original(self):
        self.assertEqual(thai_date("not-a-date"), "not-a-date")


if __name__ == "__main__":
    unittest.main()
