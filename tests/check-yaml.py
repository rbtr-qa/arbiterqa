"""Parse action.yml, every workflow, and every ```yaml block in the README.

A plain YAML scalar containing ': ' (a jq filter, say) is a parse error that GitHub reports
only as a failed run; this catches it in the pull request instead.
"""
import glob
import re
import sys

import yaml

failed = False
files = ["action.yml", *sorted(glob.glob(".github/workflows/*.yml"))]
for path in files:
    try:
        yaml.safe_load(open(path))
    except yaml.YAMLError as e:
        failed = True
        print(f"{path}: {e}")
for i, block in enumerate(re.findall(r"```yaml\n(.*?)```", open("README.md").read(), re.S)):
    try:
        yaml.safe_load(block)
    except yaml.YAMLError as e:
        failed = True
        print(f"README.md yaml block {i + 1}: {e}")
sys.exit(1 if failed else 0)
