import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts'
import type { Finding } from './core.ts'
const digits=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001','111100111001111','111100111101111','111001001001001','111101111101111','111101111001111']
export async function workingImage(bytes:Uint8Array){
 const image=await Image.decode(bytes)
 const scale=Math.min(1,1200/Math.max(image.width,image.height));if(scale<1)image.resize(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)))
 let jpeg=await image.encodeJPEG(60)
 for(let attempt=0;jpeg.length>140000&&attempt<4;attempt++){
  const shrink=Math.min(.8,Math.sqrt(130000/jpeg.length))
  image.resize(Math.max(1,Math.round(image.width*shrink)),Math.max(1,Math.round(image.height*shrink)))
  jpeg=await image.encodeJPEG(50)
 }
 if(jpeg.length>140000)throw new Error('working_copy_size_limit')
 return {image,jpeg}
}
export function annotate(image:Image,findings:Finding[]){
 const red=0xe32929ff,white=0xffffffff
 const pixel=(x:number,y:number,color:number)=>{if(x>=1&&y>=1&&x<=image.width&&y<=image.height)image.setPixelAt(Math.round(x),Math.round(y),color)}
 findings.forEach((finding,index)=>{
  if(!finding.box)return
  const b=finding.box,x=Math.max(2,Math.round(b.x*image.width)),y=Math.max(2,Math.round(b.y*image.height)),w=Math.round(b.w*image.width),h=Math.round(b.h*image.height)
  for(let t=0;t<3;t++){for(let i=x;i<=x+w;i++){pixel(i,y+t,red);pixel(i,y+h-t,red)}for(let j=y;j<=y+h;j++){pixel(x+t,j,red);pixel(x+w-t,j,red)}}
  const labelY=Math.max(2,y-26),labelX=Math.min(x,image.width-25)
  for(let i=0;i<24;i++)for(let j=0;j<24;j++)pixel(labelX+i,labelY+j,red)
  const glyph=digits[index+1];if(glyph)for(let i=0;i<15;i++)if(glyph[i]==='1')for(let dx=0;dx<3;dx++)for(let dy=0;dy<3;dy++)pixel(labelX+7+(i%3)*3+dx,labelY+4+Math.floor(i/3)*3+dy,white)
 });return image
}
