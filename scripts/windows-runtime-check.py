"""Validate actual local Maia inference; no downloads or global Python packages."""
import argparse
import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

parser = argparse.ArgumentParser()
parser.add_argument("--device", choices=["cpu", "cuda"], required=True)
parser.add_argument("--checkpoint", required=True)
parser.add_argument("--threads", type=int, required=True)
args = parser.parse_args()

import torch
from maia3.uci import Maia3UCIEngine, parse_args

torch.set_num_threads(args.threads)
if args.device == "cuda":
    assert torch.cuda.is_available(), "CUDA driver/device unavailable"
    # This catches unsupported GPU architectures even if is_available() is true.
    value = torch.ones((16, 16), device="cuda")
    assert (value @ value).sum().item() == 4096
    torch.cuda.synchronize()

cfg = parse_args([
    "--model", "maia3-79m", "--checkpoint-path", args.checkpoint,
    "--device", args.device, "--local-files-only", "--use-uci-history", "--no-use-amp",
])
engine = Maia3UCIEngine(cfg)
engine.ensure_model_loaded()
engine.cmd_position("position startpos moves e2e4 e7e5")
move, candidates = engine.score_moves()
assert move in engine.board.legal_moves and candidates, "Maia produced no legal prediction"
print(f"Maia inference passed: {args.device}; torch {torch.__version__}")
