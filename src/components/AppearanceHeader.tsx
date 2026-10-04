import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { useManagementAccess } from './ManagementAccess'
import { AppAppearance } from './AppAppearance'
import '../pages/SettingsNavigation.css'
export function AppearanceHeader(){
 const access=useManagementAccess()
 return <><AppAppearance />{access.gm&&<Link className="settings-header-link" to="/settings"><Settings size={20} aria-hidden="true"/><span>Settings</span></Link>}</>
}
