#!/usr/bin/env python3
"""Check staged source dependencies; optionally build a clean export of the index."""
from pathlib import Path
import argparse,re,subprocess,tempfile,sys
p=argparse.ArgumentParser();p.add_argument('--stage-dependencies',action='store_true');p.add_argument('--build',action='store_true');args=p.parse_args()
def git(*a):return subprocess.check_output(['git',*a],text=True)
root=Path(git('rev-parse','--show-toplevel').strip());tracked=set(git('ls-files').splitlines());missing=set();unresolved=[]
pattern=re.compile(r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.[^"']+)\1''')
queue=[f for f in tracked if f.startswith('src/') and Path(f).suffix in ('.ts','.tsx','.js','.jsx')];seen=set()
while queue:
 name=queue.pop()
 if name in seen:continue
 seen.add(name)
 # Check the staged content when tracked, working content only for newly found dependencies.
 try:text=git('show',':'+name) if name in tracked else (root/name).read_text()
 except Exception:unresolved.append(name+' could not be read');continue
 for _,ref in pattern.findall(text):
  base=(root/name).parent/ref.split('?')[0]
  candidates=[base]+[Path(str(base)+ext) for ext in ('.ts','.tsx','.js','.jsx','.css','.json')]+[base/('index'+ext) for ext in ('.ts','.tsx','.js','.jsx')]
  found=next((x for x in candidates if x.is_file()),None)
  if found is None:unresolved.append(name+' imports missing '+ref);continue
  try:rel=str(found.resolve().relative_to(root))
  except ValueError:unresolved.append(name+' imports outside repository');continue
  if rel not in tracked:missing.add(rel)
  if found.suffix in ('.ts','.tsx','.js','.jsx'):queue.append(rel)
if unresolved:
 print('Missing source files:\n'+'\n'.join(sorted(set(unresolved))));sys.exit(1)
if missing:
 print('Dependencies absent from the Git index:\n'+'\n'.join(sorted(missing)))
 if not args.stage_dependencies:print('Rerun with --stage-dependencies to stage these exact files, then review git diff --cached.');sys.exit(1)
 subprocess.run(['git','add','--',*sorted(missing)],cwd=root,check=True)
 print('Staged only the missing dependencies. Review git diff --cached --stat.')
print('Staged import dependency check passed.')
if args.build:
 with tempfile.TemporaryDirectory(prefix='justinis-release-') as directory:
  subprocess.run(['git','checkout-index','--all','--prefix='+directory+'/'],cwd=root,check=True)
  if not (Path(directory)/'package-lock.json').exists():sys.exit('Stage package-lock.json before the clean build.')
  subprocess.run(['npm','ci','--no-audit','--no-fund'],cwd=directory,check=True)
  subprocess.run(['npm','run','build'],cwd=directory,check=True)
 print('Clean staged-source build passed. Review and commit the staged files, then push.')
