import * as THREE from 'three';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

camera.position.z = 5;

const geometry = new THREE.BoxGeometry(3,3,3);
const color = new THREE.Color( "#7833aa" );
const material = new THREE.MeshLambertMaterial( {color: color.getHex()} );

const cube = new THREE.Mesh(geometry, material);
cube.rotation.x = 0.5;
cube.rotation.y = 0.5;
scene.add(cube);

console.log(geometry);
console.log(geometry.attributes);
console.log(Object.keys(geometry.attributes));




/* we need to add a light so we can see our cube - its almost
as if we're turning on a lightbulb within the room */
const light = new THREE.AmbientLight(0xFFFF00);
/* position the light so it shines on the cube (x, y, z) */
light.position.set(5, 5, 5);
scene.add(light);
const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

const textureLoader = new THREE.TextureLoader();

textureLoader.load(
  'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTYj49HzTigOoMsMErqQEqYPMCJ_BdlRJ4Deg&s',
  function (texture) {

    // repeat texture
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);

    // IMPORTANT: assign to existing material
    material.map = texture;
    material.needsUpdate = true;
  }
);

function animate( time ) {

  renderer.render( scene, camera );
}
renderer.setAnimationLoop( animate );

