import bgGeneric from '../assets/background/background-generic.webp'
import obj1 from '../assets/background/object-generic-1.webp'
import obj2 from '../assets/background/object-generic-2.webp'
import obj3 from '../assets/background/object-generic-3.webp'

export function SceneBackground() {
  return (
    <div className="scene-root">
      <div className="scene-bg" style={{ backgroundImage: `url(${bgGeneric})` }} />
      <img src={obj1} alt="" className="scene-obj scene-obj-1" />
      <img src={obj2} alt="" className="scene-obj scene-obj-2" />
      <img src={obj3} alt="" className="scene-obj scene-obj-3" />
    </div>
  )
}
