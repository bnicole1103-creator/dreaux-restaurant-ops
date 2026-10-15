import {PageWord} from './PageDesign'
import { Component, type PropsWithChildren } from 'react'
export class PageRecovery extends Component<PropsWithChildren, {failed:boolean}> {
  state = {failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(error:Error){console.error('Page could not render:',error)}
  render(){
    if(this.state.failed)return <section data-design-block="section.d136b76af3084fb90b05" className="page card"><h1><PageWord id="sectioncopy.65969654b00abc6ae0ee">{"This page could not open"}</PageWord></h1><p role="alert"><PageWord id="sectioncopy.b12bf28d2a8133cf5abb">{"Please retry. If it fails again, open another page using the navigation."}</PageWord></p><button type="button" onClick={()=>this.setState({failed:false})}><PageWord id="sectioncopy.1a7dd62f259b1cee73bc">{"Retry page"}</PageWord></button></section>
    return this.props.children
  }
}
