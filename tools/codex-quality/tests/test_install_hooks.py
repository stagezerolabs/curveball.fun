import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "install_hooks.py"


class HookMergeInstallerTests(unittest.TestCase):
    def test_preserves_unrelated_hooks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"
            destination = root / "hooks.json"
            source.write_text(
                json.dumps(
                    {
                        "hooks": {
                            "Stop": [
                                {
                                    "hooks": [
                                        {
                                            "type": "command",
                                            "command": "/usr/bin/python3 /Users/macbook/.codex/hooks/quality_gate.py stop",
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                )
            )
            existing_group = {
                "hooks": [{"type": "command", "command": "python3 existing.py"}]
            }
            destination.write_text(
                json.dumps({"description": "existing", "hooks": {"Stop": [existing_group]}})
            )

            subprocess.run(
                ["python3", str(INSTALLER), str(source), str(destination)], check=True
            )
            subprocess.run(
                ["python3", str(INSTALLER), str(source), str(destination)], check=True
            )

            installed = json.loads(destination.read_text())
            groups = installed["hooks"]["Stop"]
            self.assertIn(existing_group, groups)
            managed = [group for group in groups if "quality_gate.py" in json.dumps(group)]
            self.assertEqual(len(managed), 1)
            backup = destination.with_name("hooks.json.pre-quality")
            self.assertTrue(backup.is_file())
            self.assertEqual(json.loads(backup.read_text())["description"], "existing")


if __name__ == "__main__":
    unittest.main()
