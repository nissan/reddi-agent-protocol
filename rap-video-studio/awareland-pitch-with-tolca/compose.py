import json,re,subprocess,glob
m=json.load(open('marks.json'))['marks']; d=json.load(open('audio/durations.json')); segs=json.load(open('segments.json'))
t0=m[0][1]; end=m[-1][1]+1.2-t0
at={k:v-t0 for k,v in m}
def ts(x):
    ms=int(round(x*1000)); h,ms=divmod(ms,3600000); mi,ms=divmod(ms,60000); s,ms=divmod(ms,1000)
    return f"{h:02}:{mi:02}:{s:02},{ms:03d}"
srt=[];n=1
for s in segs:
    parts=[p.strip() for p in re.split(r'(?<=[.?])\s+',s['caption']) if p.strip()]
    chunks=[]
    for p in parts:
        if chunks and len(chunks[-1])+len(p)<110: chunks[-1]+=' '+p
        else: chunks.append(p)
    tot=sum(len(c) for c in chunks); st=at[s['id']]
    for c in chunks:
        du=d[s['id']]*len(c)/tot
        srt.append(f"{n}\n{ts(st)} --> {ts(st+du-0.05)}\n{c}\n");n+=1;st+=du
open('subs.srt','w').write('\n'.join(srt))
v=glob.glob('vid/*.webm')[0]
ins=['-ss',str(t0),'-t',str(end),'-i',v]; fl=[]; lab=[]
for i,s in enumerate(segs):
    ins+=['-i',f"audio/{s['id']}.wav"]; ms=int(at[s['id']]*1000)
    fl.append(f"[{i+1}:a]adelay={ms}|{ms}[a{i}]"); lab.append(f"[a{i}]")
fl.append(''.join(lab)+f"amix=inputs={len(segs)}:normalize=0,apad[aout]")
fl.append("[0:v]subtitles=subs.srt:force_style='FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,OutlineColour=&H50000000,BorderStyle=3,Outline=6,Shadow=0,MarginV=14,MarginL=40,MarginR=40',drawtext=text='Sandbox simulation, test funds':fontcolor=white@0.9:fontsize=16:box=1:boxcolor=black@0.6:boxborderw=8:x=w-tw-24:y=90[vout]")
subprocess.run(['ffmpeg','-loglevel','error','-y',*ins,'-filter_complex',';'.join(fl),'-map','[vout]','-map','[aout]','-t',str(end),'-c:v','libx264','-preset','medium','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','rap-awareland-pitch-for-francesco.mp4'],check=True)
json.dump([[k,round(v,3)] for k,v in at.items()],open('marks-rel.json','w')); print(end)
