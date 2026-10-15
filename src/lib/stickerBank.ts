export const stickerBank=[
 ['pumpkin','🎃','Halloween','Pumpkin'],['ghost','👻','Halloween','Ghost'],['bat','🦇','Halloween','Bat'],['web','🕸️','Halloween','Spiderweb'],['candy','🍬','Halloween','Candy'],
 ['maple','🍁','Fall','Maple leaf'],['leaves','🍂','Fall','Fall leaves'],['sunflower','🌻','Fall','Sunflower'],['pie','🥧','Fall','Pie'],
 ['tree','🎄','Holidays','Christmas tree'],['snow','❄️','Holidays','Snowflake'],['snowman','⛄','Holidays','Snowman'],['gift','🎁','Holidays','Gift'],['bow','🎀','Holidays','Bow'],
 ['heart','💖','Valentine’s','Heart'],['rose','🌹','Valentine’s','Rose'],['kiss','💋','Valentine’s','Kiss'],['hearts','💕','Valentine’s','Two hearts'],
 ['mask','🎭','Mardi Gras','Mask'],['crown','👑','Mardi Gras','Crown'],['fleur','⚜️','Mardi Gras','Fleur-de-lis'],['confetti','🎊','Mardi Gras','Confetti'],
 ['flower','🌸','Spring','Blossom'],['tulip','🌷','Spring','Tulip'],['butterfly','🦋','Spring','Butterfly'],['rainbow','🌈','Spring','Rainbow'],
 ['sun','☀️','Summer','Sun'],['lemon','🍋','Summer','Lemon'],['palm','🌴','Summer','Palm'],['watermelon','🍉','Summer','Watermelon'],
 ['sparkle','✨','Everyday','Sparkles'],['cocktail','🍸','Everyday','Cocktail'],['cheers','🥂','Everyday','Cheers'],['star','⭐','Everyday','Star'],['music','🎶','Everyday','Music'],['party','🎉','Everyday','Party']
] as const
export type StickerId=typeof stickerBank[number][0]
export type DecorationSticker={key:string;id:StickerId;size:number;rotation:number;spot:'left'|'banner'|'right'|'free';page?:string;x?:number;y?:number;opacity?:number;layer?:'front'|'back'}
export type Decorations={enabled:boolean;items:DecorationSticker[]}
export const emptyDecorations:Decorations={enabled:false,items:[]}
export const decorationPacks:Record<string,StickerId[]>={Halloween:['pumpkin','ghost','bat','candy'],Fall:['maple','leaves','sunflower','pie'],Holidays:['tree','snow','gift','bow'],'Valentine’s':['heart','rose','kiss','hearts'],'Mardi Gras':['mask','crown','fleur','confetti'],Spring:['flower','tulip','butterfly','rainbow'],Summer:['sun','lemon','palm','watermelon'],Everyday:['sparkle','cocktail','cheers','star']}
export function newSticker(id:StickerId,index:number):DecorationSticker{return {key:crypto.randomUUID(),id,size:56,rotation:index%2?-8:8,spot:'free',page:'/',x:15+index*20,y:50+index*80,opacity:1,layer:'front'}}

export const stickerPages=[['*','Every page'],['/','Home'],['/floor','Floor'],['/closeout','Closeout'],['/preshift','Posts'],['/rewards','Points'],['/closeout-summary','Summary'],['/tasks','Tasks'],['/team','Team'],['/calendar','Calendar'],['/quizzes','Quizzes'],['/training','Training'],['/inventory','Inventory'],['/inquiry-inbox','Guest Services'],['/settings','Settings']] as const
export const stickerDraftKey=(location:string)=>'sticker-placement:'+location
export const bound=(v:number,min:number,max:number)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):min
export function stickerOnPage(item:DecorationSticker,path:string){return !item.page||item.page==='*'||item.page===path}
export function stickerPosition(item:DecorationSticker){return {x:bound(item.x??50,0,100),y:bound(item.y??60,0,50000),opacity:bound(item.opacity??1,0,1),size:bound(item.size,28,200)}}
