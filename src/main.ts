import * as THREE from 'three';
import { createPlayer, updatePlayer } from './player';
import { keys } from './input';
import { createWorld } from './world';
import { createMapSystem } from './map';

const scene = new THREE.Scene();
createWorld(scene);
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
const mapSystem = createMapSystem();

const player = createPlayer(camera);
scene.add(player);  

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

const timer = new THREE.Timer();
timer.connect(document);

function animate(timestamp?: number) {
  requestAnimationFrame(animate);

  timer.update(timestamp);
  const delta = timer.getDelta();
  updatePlayer(player, mapSystem, keys, delta);
  console.log(`Player position: ${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}`);
  console.log(`Player rotation: ${player.rotation.x.toFixed(2)}, ${player.rotation.y.toFixed(2)}, ${player.rotation.z.toFixed(2)}`);
  renderer.render(scene, camera);
}

animate();
