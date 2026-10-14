export async function prepareRecipePhoto(file:File):Promise<string>{
 if(file.size>12*1024*1024)throw Error('Choose a photo smaller than 12 MB.');
 if(!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type))throw Error('Choose a JPG, PNG, WebP or supported iPhone photo.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight)throw Error('This image has no usable dimensions.');
  const canvas=document.createElement('canvas');const ratio=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo processing is unavailable.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [.85,.7,.55,.4]){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<=800000)return data;}
  throw Error('This photo is too detailed. Choose a smaller photo.');
 }catch(e){if(e instanceof Error&&e.name==='EncodingError')throw Error('Your browser could not open that format. Export the photo as JPG and try again.');throw e;}
 finally{URL.revokeObjectURL(url);}
}
