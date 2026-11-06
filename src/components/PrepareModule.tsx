import type {ReactNode} from 'react'
export function PrepareModule({title,collapsible,initiallyOpen,onOpen,children}:{title:string;collapsible:boolean;initiallyOpen:boolean;onOpen:()=>void;children:ReactNode}){
 if(!collapsible)return <section aria-label={title}>{children}</section>
 return <details className="prepare-module" open={initiallyOpen||undefined} onToggle={e=>{if(e.currentTarget.open)onOpen()}}><summary>{title}</summary>{children}</details>
}
