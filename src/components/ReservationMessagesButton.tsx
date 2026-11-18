import {useEffect,useRef,useState} from 'react'
import {readGuestContact,watchGuestRefresh} from '../lib/guestContact'
import {messageComposerUrl} from '../lib/messageComposer'

export function ReservationMessagesButton({location,reservationId,message,disabled=false,autoOpen=false}:{location:string;reservationId:string;message:string;disabled?:boolean;autoOpen?:boolean}){
 const [phone,setPhone]=useState('')
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 useEffect(()=>{
  let live=true,generation=0
  setPhone('');setLoading(true);setError('')
  const refresh=()=>{
   const ticket=++generation
   void readGuestContact(location,reservationId).then(contact=>{
    if(live&&ticket===generation){setPhone(contact.phone??'');setError('');setLoading(false)}
   }).catch(()=>{
    if(live&&ticket===generation){setPhone('');setError('Guest phone number could not load.');setLoading(false)}
   })
  }
  refresh()
  const stop=watchGuestRefresh(refresh,location)
  return()=>{live=false;generation++;stop()}
 },[location,reservationId])
 const apple=/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
 const href=messageComposerUrl(phone,message,apple)
 const opened=useRef(false)
 useEffect(()=>{if(autoOpen&&href&&!disabled&&!opened.current){opened.current=true;window.location.href=href}},[autoOpen,href,disabled])
 return <div>
  {href&&!disabled?<a className="primary-button" style={{display:'inline-flex',alignItems:'center',minHeight:44,padding:'10px 16px'}} href={href}>Open in Messages</a>:<button type="button" disabled>{loading?'Loading guest phone…':'Open in Messages'}</button>}
  <p>{href?'Opens a message addressed to '+phone+' with this invitation. Review it and press Send in Messages.':error||(!loading?'Add a valid guest phone number to open Messages.':'Loading the saved guest phone number…')}</p>
 </div>
}
