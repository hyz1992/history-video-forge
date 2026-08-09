import contextlib
import io
import unittest

from dev_start import build_prepare_commands, parse_args


class DevStartArgumentsTest(unittest.TestCase):
    def test_prepares_database_by_default(self) -> None:
        self.assertTrue(parse_args([]).prepare_db)

    def test_can_explicitly_skip_database_preparation(self) -> None:
        self.assertFalse(parse_args(["--skip-db-prepare"]).prepare_db)

    def test_keeps_prepare_db_flag_compatible(self) -> None:
        self.assertTrue(parse_args(["--prepare-db"]).prepare_db)

    def test_uses_non_interactive_migrate_deploy(self) -> None:
        commands = build_prepare_commands()

        self.assertIn(["npx", "prisma", "migrate", "deploy"], commands)
        self.assertNotIn(["npx", "prisma", "migrate", "dev"], commands)


if __name__ == "__main__":
    with contextlib.redirect_stderr(io.StringIO()):
        unittest.main()
