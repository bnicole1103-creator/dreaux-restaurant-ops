import { Link } from 'react-router-dom'
import { useManagementAccess } from './ManagementAccess'
import { AppAppearance } from './AppAppearance'
export function AppearanceHeader(){
 const access=useManagementAccess()
 return <><AppAppearance />{access.gm&&<Link to="/appearance">Appearance</Link>}</>
}
