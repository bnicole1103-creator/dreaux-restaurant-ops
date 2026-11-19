import {isPageModuleLoadError} from '../lib/pageLoadError'
import {DesignSection} from './DesignSection'
import {PageWord} from './PageDesign'
import { Component, type PropsWithChildren } from 'react'
export class PageRecovery extends Component<PropsWithChildren, {failed:boolean;reload:boolean}> {
  state = {failed:false,reload:false}
  static getDerivedStateFromError(error:unknown){return {failed:true,reload:isPageModuleLoadError(error)}}
  componentDidCatch(error:Error){console.error('Page could not render:',error)}
  render(){
    if(this.state.failed){
      const reload = this.state.reload
      return <DesignSection as="section" data-design-block="section.d136b76af3084fb90b05" className="page card">
        <h1><PageWord id="sectioncopy.65969654b00abc6ae0ee">{"This page could not open"}</PageWord></h1>
        <p role="alert">{reload
          ? 'Reload the app to get the latest page files.'
          : <PageWord id="sectioncopy.b12bf28d2a8133cf5abb">{"Please retry. If it fails again, reload the app or open another page using the navigation."}</PageWord>}</p>
        {!reload && <button type="button" onClick={()=>this.setState({failed:false,reload:false})}>
          <PageWord id="sectioncopy.1a7dd62f259b1cee73bc">{"Retry page"}</PageWord>
        </button>}
        <button type="button" onClick={()=>window.location.reload()}>Reload app</button>
      </DesignSection>
    }
    return this.props.children
  }
}
