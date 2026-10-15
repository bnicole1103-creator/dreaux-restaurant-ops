import {PostMedia,type MediaAsset} from './PostMedia'
import './DashboardPostPreview.css'
export function DashboardPostPreview({body,media=[],color,font}:{body:string;media?:MediaAsset[];color?:string;font?:string}){
 const text=Array.from(body??''),excerpt=text.length>800?text.slice(0,800).join('').trimEnd()+'…':body
 const image=media.find(asset=>asset.kind==='image')
 return <div className="dashboard-post-preview" data-design-block="home.posts.inline-preview" aria-label="Post preview"><div className="dashboard-post-preview-text" style={{color,fontFamily:font}}>{excerpt}</div>{image&&<div className="dashboard-post-preview-image"><PostMedia assets={[image]}/></div>}</div>
}
