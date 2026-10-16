"""Local-only policy adapter for pinned CSSLab/maia3; no model downloads."""
import argparse
import json
import sys
import torch
from maia3.uci import Maia3UCIEngine, parse_args

parser = argparse.ArgumentParser()
parser.add_argument('--checkpoint-path', required=True)
parser.add_argument('--device', choices=['auto', 'cpu', 'mps', 'cuda'], default='auto')
args = parser.parse_args()
device = args.device
if device == 'auto':
    device = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
# Explicit local checkpoint prevents network access. Upstream owns tokenization,
# legal masking, history, Elo conditioning, and softmax policy probabilities.
cfg = parse_args(['--model', 'maia3-79m', '--checkpoint-path', args.checkpoint_path,
                  '--device', device, '--local-files-only', '--use-uci-history', '--no-use-amp'])
torch.set_num_threads(4)
print(f'Maia 3 79M · device={device} · torch={torch.__version__}', file=sys.stderr, flush=True)

class PolicyEngine(Maia3UCIEngine):
    def cmd_go(self, line):
        self.ensure_model_loaded()
        move, candidates = self.score_moves()
        print('info string maia-policy ' + json.dumps([
            {'move': item['move'].uci(), 'probability': item['policy']} for item in candidates
        ]), flush=True)
        self.print_bestmove(move)

PolicyEngine(cfg).run()
