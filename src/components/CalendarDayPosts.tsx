import {AccessSection} from './AppAccess'
import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {Link} from 'react-router-dom'
import {supabase} from '../lib/supabase'
import {PostMedia,type MediaAsset} from './PostMedia'
import {PostDiscussion} from './PostDiscussion'
import {PreshiftOpenTracker} from './PreshiftActivity'
import {appFonts,type FontName} from '../lib/appearance'
import {postStyle,postColors,type PostColor} from '../lib/postStyle'
type DayPost={id:string;version:number;shift_date:string;title:string;body:string;media?:MediaAsset[];presentation?:{accent?:PostColor;title?:PostColor;text?:PostColor;titleFont?:FontName;textFont?:FontName}}
export function CalendarDayPosts({location,date}:{location:string;date:string}){
 const [posts,setPosts]=useState<DayPost[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
 useEffect(()=>{let live=true;setLoading(true);setPosts([]);setError('');void supabase.rpc('calendar_day_posts',{p_location_id:location,p_date:date}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else setPosts(r.data??[]);setLoading(false)});return()=>{live=false}},[location,date])
 return <section data-design-block="section.6647e5f3d38e713b04d5"><h3><PageWord id="sectioncopy.624fb1b7be6bdbb426f1">{"Posts for this day"}</PageWord></h3>{loading&&<p role="status"><PageWord id="sectioncopy.75cec668eb1df996ccec">{"Loading posts…"}</PageWord></p>}{error&&<p role="alert">{error}</p>}{!loading&&!error&&!posts.length&&<p><PageWord id="sectioncopy.01a85b402dc705c575f0">{"No posts for this day yet."}</PageWord></p>}{posts.map(p=><article data-design-block="section.6405cc7b063ebe0f8a82" className="calendar-post" key={p.id} style={postStyle(p.presentation)}><h3 style={{fontFamily:appFonts[p.presentation?.titleFont??'system']?.css,color:postColors[p.presentation?.title??'brown']?.ink}}>{p.title}</h3><div className="home-post-body feed-body" style={{whiteSpace:'pre-wrap',fontFamily:appFonts[p.presentation?.textFont??'system']?.css,color:postColors[p.presentation?.text??'brown']?.ink}}>{p.body}</div><PostMedia assets={p.media??[]}/><PreshiftOpenTracker location={location} postId={p.id} version={p.version} source="feed"/><AccessSection page="posts" section="discussion"><PostDiscussion location={location} postId={p.id}/></AccessSection></article>)}<Link to="/preshift"><PageWord id="sectioncopy.85045c79d6642274be45">{"Open Posts →"}</PageWord></Link></section>
}
