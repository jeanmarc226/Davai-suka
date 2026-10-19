from PIL import Image, ImageDraw
def icon(size):
    S=size*4
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    # full-bleed background (maskable-safe), subtle gradient
    for y in range(S):
        t=y/S; c=(int(20+10*t),int(24+6*t),int(32+10*t),255)
        d.line([(0,y),(S,y)],fill=c)
    lime=(198,255,61,255)
    cx=cy=S/2; u=S/100
    # dumbbell inside safe zone (~60%)
    d.rounded_rectangle([cx-26*u,cy-3.5*u,cx+26*u,cy+3.5*u],radius=3*u,fill=lime)
    for sgn in (-1,1):
        x=cx+sgn*22*u
        d.rounded_rectangle([x-5*u,cy-17*u,x+5*u,cy+17*u],radius=3*u,fill=lime)
        x2=cx+sgn*30*u
        d.rounded_rectangle([x2-3.5*u,cy-11*u,x2+3.5*u,cy+11*u],radius=2.5*u,fill=lime)
    return im.resize((size,size),Image.LANCZOS)
for s in (192,512): icon(s).save(f'icons/icon-{s}.png')
icon(180).save('icons/apple-touch-icon.png')
