import { ScreenText } from "./ScreenText"
import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { useManagementAccess } from './ManagementAccess'
import { AppAppearance } from './AppAppearance'
import '../pages/SettingsNavigation.css'
export function AppearanceHeader(){
 const access=useManagementAccess()
 return <><AppAppearance />{access.gm&&<Link className="settings-header-link" to="/settings"><Settings size={20} aria-hidden="true"/><span><ScreenText id="AppearanceHeader.84360f079ab37551">Settings</ScreenText></span></Link>}</>
}
