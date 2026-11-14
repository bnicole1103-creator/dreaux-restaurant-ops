import {Component,type ReactNode} from 'react'
import {startupMessage} from '../startupError'
export class StartupBoundary extends Component<{children:ReactNode},{message:string}>{
 state={message:''};static getDerivedStateFromError(error:unknown){return {message:startupMessage(error)}}
 render(){return this.state.message?<section role="alert" style={{maxWidth:680,margin:'40px auto',padding:24,fontFamily:'system-ui',background:'#fff8ef',color:'#39291e'}}><h1>JusTini’s encountered a screen error</h1><p style={{overflowWrap:'anywhere'}}>{this.state.message}</p><p>Send this error so the failing screen can be corrected. No reservation changes were made by this error screen.</p><button onClick={()=>window.location.reload()}>Reload app</button></section>:this.props.children}
}
