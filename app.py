"""Looproom: local-only music video studio. Python standard library + FFmpeg."""
import argparse
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote
from explorer import request_open
"""Review-only scans and explicitly confirmed cleanup of app-owned working files."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import stat
import time

class StorageManager:
    def __init__(self,data,db,lock,imports_busy):
        self.data=Path(data).absolute();self.db=db;self.lock=lock;self.imports_busy=imports_busy;self.plans={}

    @staticmethod
    def plain(path):
        try:
            info=path.lstat()
            return not (path.is_symlink() or getattr(info,'st_file_attributes',0)&0x400)
        except OSError:return False

    def scan(self):
        with self.lock:
            with self.db() as con:
                media=[dict(r) for r in con.execute('SELECT * FROM media')]
                jobs=[dict(r) for r in con.execute('SELECT * FROM jobs')]
                row=con.execute("SELECT value FROM settings WHERE key='draft'").fetchone()
            draft=json.loads(row[0]) if row else {}
            draft_ids=set()
            def visit(value):
                if isinstance(value,dict):
                    if isinstance(value.get('id'),str):draft_ids.add(value['id'])
                    for item in value.values():visit(item)
                elif isinstance(value,list):
                    for item in value:visit(item)
            visit(draft)
            with self.db() as con:
                saved=con.execute("SELECT value FROM settings WHERE key='templates'").fetchone()
            template_ids={t.get("art") for t in json.loads(saved[0])} if saved else set()
            past={};active=set();export_paths=set();busy=self.imports_busy()
            for job in jobs:
                config=json.loads(job['config'])
                for mid in set((config.get('audio'),config.get('art'))):
                    if job['status'] in ('queued','rendering'):active.add(mid);busy=True
                    elif isinstance(mid,str):past.setdefault(mid,set()).add(job['id'])
                if job['output']:
                    p=Path(job['output']);export_paths.update((p,p.with_suffix('.txt'),p.with_suffix('.json')))
            exports=0
            for p in export_paths:
                try:
                    if self.plain(p) and p.is_file():exports+=p.stat().st_size
                except OSError:pass
            bypath={}
            for record in media:bypath.setdefault(os.path.normcase(os.path.abspath(record['path'])),[]).append(record)
            rows=[];now=time.time()
            roots=[(self.data/'imports','copy'),(self.data,'temporary')]
            # Never follow junctions, symlinks, or unrecognized filenames.
            for root,kind in roots:
                if not self.plain(self.data) or not self.plain(root):continue
                for p in root.iterdir():
                    pattern=r'[0-9a-f]{32}\.[a-z0-9]+' if kind=='copy' else r'[0-9a-f]{32}(?:\.log|-loop\.mp4)'
                    if not re.fullmatch(pattern,p.name) or not self.plain(p):continue
                    info=p.lstat()
                    if not stat.S_ISREG(info.st_mode):continue
                    records=bypath.get(os.path.normcase(str(p.absolute())),[])
                    ids={r['id'] for r in records}
                    reason=''
                    if ids&template_ids:reason='Used by a release template'
                    elif ids&draft_ids:reason='Used by the saved draft'
                    elif ids&active:reason='Used by a queued or running export'
                    elif now-info.st_mtime<600:reason='Recently added — available for cleanup after 10 minutes'
                    uses=len(set().union(*(past.get(mid,set()) for mid in ids)))
                    rel=p.relative_to(self.data).as_posix()
                    rows.append({'id':hashlib.sha256(rel.encode()).hexdigest(),'name':records[0]['name'] if records else p.name,'size':info.st_size,'kind':kind,'protected':bool(reason),'reason':reason,'pastUses':uses,'path':str(p),'fingerprint':[info.st_size,info.st_mtime_ns,info.st_ino],'mediaIds':sorted(ids)})
            disk=shutil.disk_usage(self.data)
            return {'rows':rows,'busy':busy,'workingBytes':sum(r['size'] for r in rows if r['kind']=='copy'),'temporaryBytes':sum(r['size'] for r in rows if r['kind']=='temporary'),'eligibleBytes':sum(r['size'] for r in rows if not r['protected']),'exportBytes':exports,'freeBytes':disk.free,'location':str(self.data)}

    @staticmethod
    def public(report):
        return {**report,'rows':[{k:v for k,v in r.items() if k not in ('path','fingerprint','mediaIds')} for r in report['rows']]}

    def review(self,ids):
        with self.lock:
            report=self.scan()
            if report['busy']:raise ValueError('Finish importing and exporting before cleaning up storage.')
            if not isinstance(ids,list) or not ids or len(ids)>10000:raise ValueError('Select files to review first.')
            if any(not isinstance(mid,str) for mid in ids):raise ValueError('Invalid selection.')
            selected=set(ids);rows=[r for r in report['rows'] if r['id'] in selected]
            if len(rows)!=len(selected) or any(r['protected'] for r in rows):raise ValueError('Some selected files changed or are protected. Refresh storage and try again.')
            now=time.time();self.plans={k:v for k,v in self.plans.items() if v['expires']>now}
            if len(self.plans)>30:self.plans.clear()
            token=secrets.token_urlsafe(32)
            self.plans[token]={'rows':rows,'expires':now+300}
            return {'token':token,'bytes':sum(r['size'] for r in rows),'count':len(rows),'pastCopies':sum(bool(r['pastUses']) for r in rows),'files':[{'name':r['name'],'size':r['size']} for r in rows]}

    def clean(self,token,confirmed):
        if confirmed is not True:raise ValueError('Review the selected files and confirm deletion first.')
        with self.lock:
            plan=self.plans.pop(token,None) if isinstance(token,str) else None
            if not plan or plan['expires']<time.time():raise ValueError('This cleanup review expired. Review the files again.')
            report=self.scan()
            if report['busy']:raise ValueError('Cleanup stopped because importing or exporting is active.')
            current={r['id']:r for r in report['rows']}
            for old in plan['rows']:
                row=current.get(old['id'])
                if not row or row['protected'] or any(row[k]!=old[k] for k in ('path','fingerprint','mediaIds','pastUses')):
                    raise ValueError('Files or their usage changed since your review. Nothing was removed. Refresh and review again.')
            count=0;freed=0;failures=[]
            for row in plan['rows']:
                p=Path(row['path'])
                # Revalidate the exact file and containment immediately before unlinking.
                if not self.plain(self.data) or not self.plain(p.parent) or not self.plain(p):
                    failures.append(row['name']+': path changed');continue
                if p.parent not in (self.data,self.data/'imports') or p.resolve().parent!=p.parent.resolve():
                    failures.append(row['name']+': unexpected location');continue
                try:
                    info=p.lstat()
                    if [info.st_size,info.st_mtime_ns,info.st_ino]!=row['fingerprint']:
                        failures.append(row['name']+': file changed');continue
                    p.unlink()
                    count+=1;freed+=row['size']
                    with self.db() as con:
                        for mid in row['mediaIds']:con.execute('DELETE FROM media WHERE id=?',(mid,))
                except OSError as exc:failures.append(row['name']+': '+str(exc))
            return {'removed':count,'freedBytes':freed,'failures':failures}


ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('LOOPROOM_DATA', ROOT / 'data'))
DATA.mkdir(parents=True, exist_ok=True)
DEFAULT_OUTPUT = ROOT / 'Videos'
DEFAULT_OUTPUT.mkdir(exist_ok=True)
FFMPEG = ROOT / 'bin' / 'ffmpeg.exe'
TOKEN = secrets.token_urlsafe(32)
PORT = 8765
LOCK = threading.RLock()
CANCEL = set()
ACTIVE = {}
IMPORTS = set()
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0

def db():
    con = sqlite3.connect(DATA / 'studio.sqlite', timeout=30)
    con.row_factory = sqlite3.Row
    return con

STORAGE = StorageManager(DATA,db,LOCK,lambda:bool(IMPORTS))

def init():
    with db() as con:
        con.executescript('''
        CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT, kind TEXT, duration REAL);
        CREATE TABLE IF NOT EXISTS tags(name TEXT PRIMARY KEY COLLATE NOCASE, used INTEGER DEFAULT 1, updated REAL);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, config TEXT, status TEXT, progress REAL DEFAULT 0, message TEXT, output TEXT, created REAL);
        ''')
        con.execute("UPDATE jobs SET status='interrupted', message='The app closed before this export finished. Load its details to try again.' WHERE status IN ('queued','rendering')")
        previous=con.execute("SELECT value FROM settings WHERE key='install_root'").fetchone()
        old_root=Path(json.loads(previous[0])) if previous else ROOT
        if old_root!=ROOT:
            def relocate(value):
                if not isinstance(value,str): return value
                try: return str(ROOT/Path(value).relative_to(old_root))
                except ValueError: return value
            def relocate_details(value):
                if isinstance(value,list): return [relocate_details(item) for item in value]
                if isinstance(value,dict): return {key:relocate(item) if key in ('path','output','outputDir') else relocate_details(item) for key,item in value.items()}
                return value
            for row in con.execute('SELECT id,path FROM media').fetchall():
                con.execute('UPDATE media SET path=? WHERE id=?',(relocate(row['path']),row['id']))
            for row in con.execute('SELECT id,config,output FROM jobs').fetchall():
                config=relocate_details(json.loads(row['config']))
                con.execute('UPDATE jobs SET config=?,output=? WHERE id=?',(json.dumps(config),relocate(row['output']),row['id']))
            for row in con.execute("SELECT key,value FROM settings WHERE key IN ('output','draft')").fetchall():
                value=json.loads(row['value'])
                value=relocate(value) if row['key']=='output' else relocate_details(value)
                con.execute('UPDATE settings SET value=? WHERE key=?',(json.dumps(value),row['key']))
        con.execute("INSERT OR REPLACE INTO settings VALUES ('install_root',?)",(json.dumps(str(ROOT)),))

def setting(key, fallback=None):
    with db() as con:
        row = con.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return json.loads(row[0]) if row else fallback

def save_setting(key, value):
    with LOCK, db() as con:
        con.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, json.dumps(value)))

def media(mid):
    with db() as con:
        row = con.execute('SELECT * FROM media WHERE id=?', (mid,)).fetchone()
    if not row or not Path(row['path']).is_file():
        raise ValueError('A source file was moved or deleted. Please select it again.')
    return dict(row)

def probe(path):
    result = subprocess.run([str(FFMPEG), '-hide_banner', '-i', str(path)], capture_output=True, text=True, errors='replace', creationflags=FLAGS, timeout=30)
    info = result.stderr
    match = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', info)
    duration = sum(float(v) * m for v, m in zip(match.groups(), [3600,60,1])) if match else 0
    return duration, bool(re.search(r'Stream .*Audio:', info)), bool(re.search(r'Stream .*Video:', info))

def prepare_still(mid):
    source=media(mid)
    if source['kind']!='image': raise ValueError('Choose a still image.')
    imports=DATA/'imports';imports.mkdir(exist_ok=True)
    target=imports/(uuid.uuid4().hex+'.mp4')
    try:
        result=subprocess.run([str(FFMPEG),'-hide_banner','-nostdin','-y','-v','error',
            '-loop','1','-framerate','30','-i',source['path'],'-t','5','-an',
            '-vf',"scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2,setsar=1,format=yuv420p",
            '-c:v','libx264','-preset','veryfast','-crf','18','-movflags','+faststart',str(target)],
            capture_output=True,creationflags=FLAGS,timeout=180)
        if result.returncode: raise ValueError('This image could not be prepared. Try saving it as a PNG or JPEG.')
        return register(target,'art',source['name'])
    except Exception:
        target.unlink(missing_ok=True)
        raise


def combine_artwork(ids, options=None):
    options=options or {}
    if not isinstance(ids,list) or not 2 <= len(ids) <= 20:
        raise ValueError('Choose between 2 and 20 videos or GIFs for a sequence.')
    # The request marks IMPORTS busy before resolving sources so cleanup cannot race it.
    clips=[media(mid) for mid in ids]
    if any(c['kind']!='video' or c['duration']<=0 for c in clips):
        raise ValueError('Sequences support videos and GIFs. Use still images on their own.')
    imports=DATA/'imports';imports.mkdir(exist_ok=True)
    target=imports/(uuid.uuid4().hex+'.mp4')
    def encode(args):
        try:
            result=subprocess.run([str(FFMPEG),'-hide_banner','-nostdin','-y','-v','error',*args],
                capture_output=True,creationflags=FLAGS,timeout=1800)
        except subprocess.TimeoutExpired:
            raise ValueError('Preparing the sequence took too long. Try shorter clips.') from None
        if result.returncode:
            raise ValueError('One of these clips could not be prepared. Try exporting it again as an MP4.')
    folder=imports/('sequence-'+uuid.uuid4().hex)
    folder.mkdir()
    try:
        # Normalize one clip at a time to bound decoder memory for larger batches.
        for index,clip in enumerate(clips):
            encode(['-i',clip['path'],'-map','0:v:0','-an',
                '-vf',filter_video(dict(options,resolution='1080'))+',fps=30,tpad=stop_mode=clone:stop_duration=1',
                '-t',str(clip['duration']),
                '-c:v','libx264','-preset','veryfast','-crf','18','-video_track_timescale','15360',str(folder/f'{index}.mp4')])
        manifest=folder/'clips.txt'
        manifest.write_text(''.join(f"file '{i}.mp4'\n" for i in range(len(clips))),encoding='utf-8')
        encode(['-f','concat','-safe','1','-i',str(manifest),'-map','0:v:0','-an','-c','copy','-movflags','+faststart',str(target)])
        return register(target,'art','Sequence: '+' → '.join(c['name'] for c in clips))
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        # Remove only the files created in this unique app-owned scratch directory.
        for name in [*(f'{i}.mp4' for i in range(len(clips))), 'clips.txt']:
            (folder/name).unlink(missing_ok=True)
        folder.rmdir()


def convert_gif(source, target):
    # Decode exactly one cycle, ignoring a GIF's embedded finite/infinite repeat count.
    # The normal video player and renderer repeat the resulting clip for the song.
    try:
        result=subprocess.run([str(FFMPEG),'-hide_banner','-nostdin','-y',
            '-ignore_loop','1','-i',str(source),'-an',
            '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black,format=yuv420p',
            '-c:v','libx264','-preset','fast','-crf','18','-fps_mode','vfr',
            '-movflags','+faststart',str(target)],capture_output=True,creationflags=FLAGS,timeout=300)
        if result.returncode: raise ValueError('This GIF could not be read. Try exporting it again as a GIF or MP4.')
    except subprocess.TimeoutExpired:
        raise ValueError('This GIF took too long to prepare. Try a smaller GIF or an MP4.') from None


def register(path, kind, display_name=None):
    path = Path(path).resolve()
    duration, audio, video = probe(path)
    image = path.suffix.lower() in ('.jpg','.jpeg','.png','.webp','.bmp')
    if kind == 'audio' and (not audio or duration <= 0):
        raise ValueError(f'{path.name}: no usable audio was found.')
    if kind == 'art' and not video:
        raise ValueError(f'{path.name}: no usable image or video was found.')
    actual = 'audio' if kind == 'audio' else ('image' if image else 'video')
    if actual == 'video' and duration <= 0:
        raise ValueError('Artwork video must have a known duration.')
    record = dict(id=uuid.uuid4().hex, path=str(path), name=display_name or path.name, kind=actual, duration=duration)
    with db() as con:
        con.execute('INSERT INTO media VALUES (:id,:path,:name,:kind,:duration)', record)
    return record

def clean_tags(tags):
    result, seen = [], set()
    for item in tags:
        item = str(item).strip().strip(',')[:100]
        if item and item.casefold() not in seen:
            result.append(item)
            seen.add(item.casefold())
    return result

def update_job(jid, **fields):
    with db() as con:
        con.execute('UPDATE jobs SET ' + ','.join(k+'=?' for k in fields) + ' WHERE id=?', (*fields.values(), jid))

def state():
    with db() as con:
        jobs = [dict(r) for r in con.execute("SELECT * FROM jobs WHERE status IN ('queued','rendering') OR id IN (SELECT id FROM jobs WHERE status NOT IN ('queued','rendering') ORDER BY created DESC LIMIT 100) ORDER BY created DESC")]
        tags = [r[0] for r in con.execute('SELECT name FROM tags ORDER BY used DESC, updated DESC')]
    for job in jobs:
        job['config'] = json.loads(job['config'])
    return dict(templates=setting('templates', []), queuePaused=setting('queue_paused', False), jobs=jobs, tags=tags, draft=setting('draft', {}), defaults=setting('defaults', {}), output=setting('output', str(DEFAULT_OUTPUT)), engine=FFMPEG.is_file())

def enqueue(configs):
    with LOCK:
        return _enqueue(configs)

def _enqueue(configs):
    if not isinstance(configs,list) or not 1 <= len(configs) <= 100:
        raise ValueError('Choose between 1 and 100 tracks per batch.')
    checked = []
    for config in configs:
        audio, art = media(config['audio']), media(config['art'])
        if audio['kind'] != 'audio' or art['kind'] not in ('image','video'):
            raise ValueError('Select audio and artwork first.')
        config = {k: config.get(k) for k in ['audio','art','title','description','tags','fit','resolution','format','crossfade']}
        config['title'] = str(config['title'] or Path(audio['name']).stem).strip()[:100]
        config['description'] = str(config['description'] or '')[:5000]
        config['tags'] = clean_tags(config['tags'] or [])
        config['fit'] = 'crop' if config['fit'] == 'crop' else 'fit'
        config['format'] = config.get('format') if config.get('format') in ('portrait','square') else 'landscape'
        config['resolution'] = '720' if str(config['resolution']) == '720' else '1080'
        config['crossfade'] = bool(config['crossfade']) and art['kind'] == 'video'
        if config['crossfade'] and art['duration'] < 1.2:
            raise ValueError('Use a video longer than 1.2 seconds for the half-second loop crossfade.')
        config['audioName'], config['artName'] = audio['name'], art['name']
        config['outputDir'] = setting('output', str(DEFAULT_OUTPUT))
        checked.append(config)
    with LOCK, db() as con:
        for config in checked:
            con.execute('INSERT INTO jobs VALUES (?,?,?,0,?,NULL,?)', (uuid.uuid4().hex,json.dumps(config),'queued','Waiting to render',time.time()))
            for tag in config['tags']:
                con.execute('INSERT INTO tags VALUES (?,1,?) ON CONFLICT(name) DO UPDATE SET used=used+1, updated=excluded.updated', (tag,time.time()))
    return dict(ok=True)

def save_template(body):
    name=str(body.get('name','')).strip()[:80]
    if not name: raise ValueError('Give your template a name.')
    config=body.get('config',{})
    art=config.get('art')
    if art and media(art)['kind'] not in ('image','video'): raise ValueError('Choose image or video artwork.')
    item=dict(id=body.get('id') or uuid.uuid4().hex,name=name,
        description=str(config.get('description') or '')[:5000], tags=clean_tags(config.get('tags') or []),
        fit='crop' if config.get('fit')=='crop' else 'fit',
        format=config.get('format') if config.get('format') in ('portrait','square') else 'landscape',
        resolution='720' if str(config.get('resolution'))=='720' else '1080',
        crossfade=bool(config.get('crossfade')),art=art)
    with LOCK:
        templates=setting('templates',[])
        if body.get('id') and not any(t['id']==body['id'] for t in templates): raise ValueError('Template no longer exists.')
        if any(t['name'].casefold()==name.casefold() and t['id']!=item['id'] for t in templates): raise ValueError('That template name is already used.')
        templates=[t for t in templates if t['id']!=item['id']]+[item]
        save_setting('templates',templates)
    return dict(ok=True,id=item['id'])

def filter_video(config):
    short=720 if str(config.get('resolution'))=='720' else 1080
    long=1280 if short==720 else 1920
    w,h = (short,long) if config.get('format')=='portrait' else (short,short) if config.get('format')=='square' else (long,short)
    if config.get('fit')=='crop':
        return f'scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,format=yuv420p'
    return f'scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p'

def run_engine(jid, args, duration, message):
    if jid in CANCEL:
        raise InterruptedError()
    logpath = DATA / f'{jid}.log'
    update_job(jid, message=message, progress=0)
    with logpath.open('w', encoding='utf-8') as log:
        proc = subprocess.Popen([str(FFMPEG),'-hide_banner','-y','-nostdin',*args,'-progress','pipe:1','-nostats'], stdout=subprocess.PIPE, stderr=log, text=True, creationflags=FLAGS)
        with LOCK:
            ACTIVE[jid] = proc
            if jid in CANCEL:
                proc.terminate()
        try:
            for line in proc.stdout:
                if line.startswith('out_time_us='):
                    try:
                        progress = min(99, max(0, float(line.split('=')[1])/1_000_000/duration*100))
                        update_job(jid, progress=progress)
                    except ValueError:
                        pass
            code = proc.wait()
        finally:
            with LOCK:
                ACTIVE.pop(jid, None)
    if jid in CANCEL:
        raise InterruptedError()
    if code:
        raise ValueError('Video engine could not finish: ' + logpath.read_text(encoding='utf-8',errors='replace')[-1600:])

def render(jid, config):
    audio, art = media(config['audio']), media(config['art'])
    outdir = Path(config['outputDir'])
    outdir.mkdir(parents=True, exist_ok=True)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_',config['title']).strip('. ')[:90] or 'Untitled'
    target = outdir / f'{name} - {jid[:8]}.mp4'
    partial = outdir / f'{name} - {jid[:8]}.partial.mp4'
    loopfile = DATA / f'{jid}-loop.mp4'
    try:
        vf = filter_video(config)
        source = art['path']
        if config['crossfade']:
            d, length = 0.5, art['duration']
            graph = f'[0:v]{vf},split=2[a][b];[a]trim=start={d},setpts=PTS-STARTPTS,fps=30,settb=AVTB[x];[b]trim=end={d},setpts=PTS-STARTPTS,fps=30,settb=AVTB[y];[x][y]xfade=transition=fade:duration={d}:offset={length-2*d},format=yuv420p[v]'
            run_engine(jid, ['-i',source,'-filter_complex',graph,'-map','[v]','-an','-c:v','libx264','-preset','veryfast','-crf','18',str(loopfile)],length-d,'Smoothing the artwork loop')
            source = str(loopfile)
        visual = ['-loop','1','-framerate','30','-i',source] if art['kind']=='image' else ['-stream_loop','-1','-i',source]
        args = [*visual,'-i',audio['path'],'-map','0:v:0','-map','1:a:0','-vf',vf,'-r','30','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-b:a','320k','-t',str(audio['duration']),'-movflags','+faststart',str(partial)]
        run_engine(jid,args,audio['duration'],'Rendering your music video')
        with LOCK:
            if jid in CANCEL:
                raise InterruptedError()
            partial.replace(target)
            details = {k:config[k] for k in ('title','description','tags')}
            target.with_suffix('.json').write_text(json.dumps(details,ensure_ascii=False,indent=2),encoding='utf-8')
            target.with_suffix('.txt').write_text(f"TITLE\n{details['title']}\n\nDESCRIPTION\n{details['description']}\n\nTAGS\n{', '.join(details['tags'])}\n",encoding='utf-8')
            update_job(jid,status='complete',progress=100,message='Ready for YouTube Studio',output=str(target))
    finally:
        partial.unlink(missing_ok=True)
        loopfile.unlink(missing_ok=True)

def worker():
    while True:
        with LOCK, db() as con:
            row = None if setting("queue_paused", False) else con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if row:
                con.execute("UPDATE jobs SET status='rendering' WHERE id=?",(row['id'],))
        if not row:
            time.sleep(.4)
            continue
        jid = row['id']
        try:
            render(jid,json.loads(row['config']))
        except InterruptedError:
            update_job(jid,status='cancelled',message='Export cancelled',progress=0)
        except Exception as exc:
            update_job(jid,status='failed',message=str(exc),progress=0)
        finally:
            CANCEL.discard(jid)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, value, status=200):
        raw = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(raw)

    def allowed(self):
        return self.headers.get('Host') in (f'127.0.0.1:{PORT}',f'localhost:{PORT}')

    def do_GET(self):
        if not self.allowed():
            return self.send_json({'error':'Invalid host'},403)
        path = urlparse(self.path).path
        try:
            if path == '/api/state':
                if self.headers.get('X-Looproom-Token') != TOKEN:
                    return self.send_json({'error':'Unauthorized'},403)
                return self.send_json(state())
            if path in ('/','/app.js','/style.css'):
                file = ROOT / ('index.html' if path=='/' else path[1:])
                raw = file.read_bytes().replace(b'__TOKEN__',TOKEN.encode())
                self.send_response(200)
                self.send_header('Content-Type',mimetypes.guess_type(file)[0] or 'text/plain')
                self.send_header('Content-Length',str(len(raw)))
                self.send_header('Cache-Control','no-store')
                self.send_header('X-Frame-Options','DENY')
                self.send_header('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' blob: data:; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(raw)
                return
            if path.startswith('/media/'):
                file = Path(media(path.split('/')[-1])['path'])
            elif path.startswith('/export/'):
                with db() as con:
                    row = con.execute("SELECT output FROM jobs WHERE id=? AND status='complete'",(path.split('/')[-1],)).fetchone()
                if not row:
                    return self.send_json({'error':'Export not found'},404)
                file = Path(row[0])
            else:
                return self.send_json({'error':'Not found'},404)
            total = file.stat().st_size
            start,end = 0,total-1
            range_header = self.headers.get('Range')
            if range_header:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)',range_header)
                if not match:
                    return self.send_json({'error':'Unsupported range'},416)
                start=int(match[1]); end=min(int(match[2]) if match[2] else end,end)
                if start>end:
                    return self.send_json({'error':'Invalid range'},416)
            self.send_response(206 if range_header else 200)
            self.send_header('Content-Type',mimetypes.guess_type(file)[0] or 'application/octet-stream')
            self.send_header('Accept-Ranges','bytes')
            self.send_header('Content-Length',str(end-start+1))
            if range_header:
                self.send_header('Content-Range',f'bytes {start}-{end}/{total}')
            self.end_headers()
            with file.open('rb') as stream:
                stream.seek(start)
                remaining=end-start+1
                while remaining:
                    chunk=stream.read(min(1024*1024,remaining))
                    if not chunk: break
                    self.wfile.write(chunk); remaining-=len(chunk)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):
            pass
        except Exception as exc:
            self.send_json({'error':str(exc)},400)

    def do_POST(self):
        if not self.allowed() or self.headers.get('X-Looproom-Token') != TOKEN:
            return self.send_json({'error':'Unauthorized'},403)
        try:
            size = int(self.headers.get('Content-Length','0'))
            path=urlparse(self.path).path
            if path=='/api/import':
                with LOCK: IMPORTS.add(threading.get_ident())
                try: return self.import_file(size)
                finally:
                    with LOCK: IMPORTS.discard(threading.get_ident())
            if size > 2_000_000:
                raise ValueError('Request too large')
            body=json.loads(self.rfile.read(size) or '{}')
            if path=='/api/draft':
                save_setting('draft',body)
            elif path=='/api/artwork/still':
                with LOCK: IMPORTS.add(threading.get_ident())
                try: return self.send_json({'file':prepare_still(body.get('id'))})
                finally:
                    with LOCK: IMPORTS.discard(threading.get_ident())
            elif path=='/api/artwork/sequence':
                with LOCK: IMPORTS.add(threading.get_ident())
                try: return self.send_json({'file':combine_artwork(body.get('ids'),body.get('options'))})
                finally:
                    with LOCK: IMPORTS.discard(threading.get_ident())
            elif path=='/api/storage':
                return self.send_json(STORAGE.public(STORAGE.scan()))
            elif path=='/api/storage/review':
                return self.send_json(STORAGE.review(body.get('ids')))
            elif path=='/api/storage/clean':
                return self.send_json(STORAGE.clean(body.get('token'),body.get('confirmed')))
            elif path=='/api/output':
                folder=Path(str(body.get('path','')).strip().strip('"')).expanduser()
                if not folder.is_absolute(): raise ValueError('Paste a complete folder path, such as C:\\Users\\YourName\\Videos.')
                folder.mkdir(parents=True,exist_ok=True)
                if not folder.is_dir(): raise ValueError('Choose a folder, not a file.')
                save_setting('output',str(folder))
                return self.send_json({'output':str(folder)})
            elif path=='/api/templates/save':
                return self.send_json(save_template(body))
            elif path=='/api/templates/apply':
                template=next((t for t in setting('templates',[]) if t['id']==body.get('id')),None)
                if not template: raise ValueError('Template not found.')
                result=dict(template)
                result.pop('id');result.pop('name')
                if result.get('art'): result['art']=media(result['art'])
                else: result.pop('art',None)
                return self.send_json(result)
            elif path=='/api/templates/delete':
                with LOCK: save_setting('templates',[t for t in setting('templates',[]) if t['id']!=body.get('id')])
            elif path=='/api/queue/pause':
                with LOCK: save_setting('queue_paused',bool(body.get('paused')))
            elif path=='/api/jobs/retry':
                with LOCK, db() as con:
                    row=con.execute('SELECT * FROM jobs WHERE id=?',(body.get('id'),)).fetchone()
                    if not row or row['status'] not in ('failed','cancelled','interrupted'): raise ValueError('Only stopped or failed exports can be retried.')
                    return self.send_json(enqueue([json.loads(row['config'])]))
            elif path=='/api/defaults':
                save_setting('defaults',body)
            elif path=='/api/jobs':
                return self.send_json(enqueue(body['configs']))
            elif path=='/api/tags/delete':
                with db() as con: con.execute('DELETE FROM tags WHERE name=?',(body['tag'],))
            elif path=='/api/load-job':
                with db() as con:
                    row=con.execute('SELECT config FROM jobs WHERE id=?',(body['id'],)).fetchone()
                if not row: raise ValueError('Export not found')
                config=json.loads(row[0])
                try:
                    config['audio']=media(config['audio'])
                    config['art']=media(config['art'])
                    return self.send_json({'track':config})
                except ValueError:
                    return self.send_json({'details':json.loads(row[0]),'warning':'Details loaded. Re-select any source files that have moved.'})
            elif path=='/api/quit':
                with LOCK, db() as con:
                    busy=con.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','rendering')").fetchone()[0]
                    if busy: raise ValueError('Finish or cancel your queued exports before closing Looproom.')
                self.send_json({'ok':True})
                threading.Thread(target=self.server.shutdown,daemon=True).start()
                return
            elif path=='/api/cancel':
                jid=body['id']
                with LOCK, db() as con:
                    row=con.execute('SELECT status FROM jobs WHERE id=?',(jid,)).fetchone()
                    if row and row[0] in ('queued','rendering'):
                        CANCEL.add(jid)
                        con.execute("UPDATE jobs SET status='cancelled',message='Export cancelled' WHERE id=? AND status='queued'",(jid,))
                        if jid in ACTIVE: ACTIVE[jid].terminate()
            elif path=='/api/open':
                selected_file=None
                if body.get('id'):
                    with db() as con: row=con.execute('SELECT output FROM jobs WHERE id=?',(body['id'],)).fetchone()
                    if not row or not row[0]: raise ValueError('This export does not have a finished video yet.')
                    selected_file=row[0]
                    folder=str(Path(selected_file).parent)
                else: folder=setting('output',str(DEFAULT_OUTPUT))
                Path(folder).mkdir(parents=True,exist_ok=True)
                warning=None
                try: request_open(folder,selected_file)
                except Exception as exc: warning=str(exc)
                return self.send_json({'ok':not warning,'folder':folder,'file':selected_file,'warning':warning})
            else:
                return self.send_json({'error':'Not found'},404)
            self.send_json({'ok':True})
        except Exception as exc:
            self.send_json({'error':str(exc)},400)

    def import_file(self, size):
        """Stream a browser-selected file to local storage, using bounded memory."""
        kind=self.headers.get('X-File-Kind')
        name=Path(unquote(self.headers.get('X-File-Name','file'))).name
        suffix=Path(name).suffix.lower()
        allowed={
            'audio':{'.mp3','.wav','.flac','.m4a','.aac','.ogg','.aiff','.aif'},
            'art':{'.gif','.png','.jpg','.jpeg','.webp','.bmp','.mp4','.mov','.mkv','.webm','.avi'},
        }
        if kind not in allowed or suffix not in allowed[kind]:
            raise ValueError('Choose a supported audio, image, or video file.')
        if not 0 < size <= 20*1024**3:
            raise ValueError('Choose a nonempty file smaller than 20 GB.')
        imports=DATA/'imports'
        imports.mkdir(exist_ok=True)
        target=imports/(uuid.uuid4().hex+suffix)
        converted=None
        try:
            self.connection.settimeout(120)
            remaining=size
            with target.open('xb') as stream:
                while remaining:
                    chunk=self.rfile.read(min(1024*1024,remaining))
                    if not chunk: raise ValueError('File transfer was interrupted. Please choose the file again.')
                    stream.write(chunk)
                    remaining-=len(chunk)
            if suffix=='.gif':
                converted=target.with_suffix('.mp4')
                convert_gif(target,converted)
            record=register(converted or target,kind,name)
            if converted: target.unlink(missing_ok=True)
        except Exception:
            target.unlink(missing_ok=True)
            if converted: converted.unlink(missing_ok=True)
            raise
        self.send_json({'file':record})

def main():
    global PORT
    parser=argparse.ArgumentParser()
    parser.add_argument('--no-browser',action='store_true')
    parser.add_argument('--port',type=int,default=8765)
    args=parser.parse_args(); PORT=args.port
    try:
        server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    except OSError:
        if not args.no_browser: webbrowser.open(f'http://127.0.0.1:{PORT}')
        return
    init()
    threading.Thread(target=worker,daemon=True).start()
    if not args.no_browser: webbrowser.open(f'http://127.0.0.1:{PORT}')
    print(f'Looproom is ready at http://127.0.0.1:{PORT}',flush=True)
    server.serve_forever()

if __name__=='__main__': main()
