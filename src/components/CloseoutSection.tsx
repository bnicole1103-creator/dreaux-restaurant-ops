import type {ReactNode} from 'react'
export function CloseoutSection({title,children,initialOpen=false}:{title:string;children:ReactNode;initialOpen?:boolean}){
 return <details className="closeout-main-section" open={initialOpen||undefined}><summary>{title}</summary><div className="closeout-section-questions">{children}</div></details>
}
