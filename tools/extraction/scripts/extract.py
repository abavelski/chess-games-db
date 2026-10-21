#!/usr/bin/env python3
"""Stage read-only inputs, recover disposable metadata, stream protocol records."""
import argparse
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from chessbase_recovery import stage_metadata_recovery
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('unpack', ROOT / 'scripts/unpack-cbv.py')
cbv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cbv)

def main():
 p=argparse.ArgumentParser(description=__doc__)
 for name in ['input','classpath','uncbv','charset','languages','count','min-year','min-annotations']:
  p.add_argument('--'+name,required=True)
 args=p.parse_args()
 with tempfile.TemporaryDirectory(prefix='unified-extract-') as temporary:
  root=Path(temporary); source=Path(args.input).resolve()
  if source.suffix.lower()=='.cbv':
   unpacked=root/'unpacked';unpacked.mkdir()
   source=cbv.unpack(args.uncbv,str(source),str(unpacked),args.charset)
  staged,actions=stage_metadata_recovery(source,root/'recovered')
  print(json.dumps({'protocol':1,'type':'recovery','actions':actions}),flush=True)
  command=['java','--enable-native-access=ALL-UNNAMED','-Dorg.slf4j.simpleLogger.defaultLogLevel=off']
  if any(a['action']=='pad_missing_optional_cbj' for a in actions):
   command.append('-Ddev.cb.recoverExtendedHeaders=true')
  command+=['-cp',args.classpath,'dev.cb.UnifiedExport',str(staged),args.count,args.min_annotations,args.min_year,args.languages,args.charset]
  child=subprocess.Popen(command)
  def stop(signum,frame):
   child.terminate()
  signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
  try:
   if child.wait(): raise RuntimeError('ChessBase extraction failed')
  finally:
   if child.poll() is None: child.terminate()
   child.wait()

if __name__=='__main__':
 try: main()
 except (OSError,ValueError,RuntimeError,subprocess.CalledProcessError) as error:
  sys.exit(str(error))
