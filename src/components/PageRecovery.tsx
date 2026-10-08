import { Component, type PropsWithChildren } from 'react'
export class PageRecovery extends Component<PropsWithChildren, {failed:boolean}> {
  state = {failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(error:Error){console.error('Page could not render:',error)}
  render(){
    if(this.state.failed)return <section className="page card"><h1>This page could not open</h1><p role="alert">Please retry. If it fails again, open another page using the navigation.</p><button type="button" onClick={()=>this.setState({failed:false})}>Retry page</button></section>
    return this.props.children
  }
}
