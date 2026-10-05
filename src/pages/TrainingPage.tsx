import { Link } from 'react-router-dom'
import './TrainingPage.css'
export function TrainingPage(){return <section className="page training-page"><p className="eyebrow">Training</p><h1>Training guides</h1><p>Your library of recipes, builds and training materials.</p><Link className="training-link" to="/training/cocktails"><strong>Cocktails</strong><span>Browse recipes and builds by category or search by name.</span></Link></section>}
