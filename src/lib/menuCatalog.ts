export const menuServices={regular:'Regular menu',brunch:'Brunch',happy_hour:'Happy hour',catering:'Catering',special:'Thursday special'} as const
export type MenuService=keyof typeof menuServices
export type MenuPrice={label:string;cents:number|null;unit:string;minimum:number}
export type MenuData={name:string;description:string;category:string;service:MenuService;notes:string;prices:MenuPrice[];available:boolean;recommend:boolean;source_file:string}
export type MenuRow={id:string;data:MenuData;version:number;archived:boolean;has_photo?:boolean;photo?:string}
export type RestaurantProfile={location_id:string;version:number;data:{title:string;description:string;notes:string}}
export type SalesMenuItem={id:string;description?:string;name:string;category:string;service:MenuService;prices:MenuPrice[]}
export const emptyMenuItem=():MenuData=>({name:'',description:'',category:'Entrées',service:'regular',notes:'',prices:[{label:'Menu price',cents:null,unit:'order',minimum:1}],available:true,recommend:true,source_file:''})
export type PricedChoice={key:string;name:string;category:string;price:MenuPrice}
export function pricedMenuChoices(items:SalesMenuItem[],service:MenuService):PricedChoice[]{return items.filter(i=>i.service===service).flatMap(i=>i.prices.flatMap((p,index)=>p.cents!==null&&Number.isSafeInteger(p.cents)&&p.cents>0&&Number.isInteger(p.minimum)&&p.minimum>0?[{key:i.id+':'+index,name:i.name,category:i.category,price:p}]:[]))}
export function menuSalesExamples(remaining:number,first:PricedChoice|null,second:PricedChoice|null){
 const gap=Math.round(remaining*100)
 if(!Number.isSafeInteger(gap)||gap<=0)return null
 const count=(cents:number,item:PricedChoice)=>Math.max(item.price.minimum,Math.ceil(cents/item.price.cents!))
 const single=(item:PricedChoice)=>{const quantity=count(gap,item);return {item,quantity,total:quantity*item.price.cents!}}
 const a=first?single(first):null,b=second&&second.key!==first?.key?single(second):null
 let mix:{item:PricedChoice;quantity:number;total:number}[]=[]
 if(first&&second&&first.key!==second.key){
  const quantity=count(gap*.7,first),left=gap-quantity*first.price.cents!
  mix=[{item:first,quantity,total:quantity*first.price.cents!}]
  if(left>0){const extra=count(left,second);mix.push({item:second,quantity:extra,total:extra*second.price.cents!})}
 }
 return {single:[a,b].filter((v):v is NonNullable<typeof v>=>!!v),mix,total:mix.reduce((sum,row)=>sum+row.total,0)}
}
