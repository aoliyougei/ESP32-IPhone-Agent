"""Exercise flash.sh argument handling without a toolchain or serial device."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class FlashFlagsTest(unittest.TestCase):
    def test_default_sta_tcp_and_missing_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hid_bridge").mkdir()
            shutil.copy(Path(__file__).parents[1] / "flash.sh", root / "flash.sh")
            cli = root / "arduino-cli"
            cli.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\n')
            cli.chmod(0o755)
            capture = root / "args"
            env = dict(os.environ, PATH=f"{root}:{os.environ['PATH']}", CAPTURE=str(capture))

            def invoke(*flags):
                return subprocess.run(
                    ["bash", str(root / "flash.sh"), *flags, "--build-only"],
                    env=env, capture_output=True, text=True,
                )

            result = invoke()
            self.assertEqual(result.returncode, 0, result.stderr)
            args = capture.read_text()
            self.assertIn("nimble_cfg.h", args)
            self.assertNotIn("TCP_CONTROL", args)
            self.assertNotIn("STA_FROM_SECRETS", args)
            capture.unlink()
            result = invoke("--tcp")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("needs hid_bridge/secrets.h", result.stdout)
            self.assertFalse(capture.exists())
            (root / "hid_bridge" / "secrets.h").write_text("// test placeholder\n")
            result = invoke("--tcp", "--debug")
            self.assertEqual(result.returncode, 0, result.stderr)
            args = capture.read_text()
            self.assertIn("-DTCP_CONTROL=1", args)
            self.assertIn("-DSTA_FROM_SECRETS=1", args)
            self.assertIn("-DDEBUG_SERIAL=1", args)
            self.assertIn("compiler.c.extra_flags=", args)
            self.assertIn("compiler.cpp.extra_flags=", args)
            result = invoke("--sta")
            self.assertEqual(result.returncode, 0, result.stderr)
            args = capture.read_text()
            self.assertIn("-DSTA_FROM_SECRETS=1", args)
            self.assertNotIn("TCP_CONTROL", args)


if __name__ == "__main__":
    unittest.main()
