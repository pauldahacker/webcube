import * as THREE from 'three';
import { SPEED, ROTATION_SPEED, PLAYER_SIZE } from './constants';
import { walls } from './world';

export function createPlayer(camera: THREE.Camera) {
    const player = new THREE.Object3D();
    const geometry = new THREE.BoxGeometry(PLAYER_SIZE, PLAYER_SIZE, PLAYER_SIZE);
    const material = new THREE.MeshPhongMaterial({
      color: 0x7833aa,
      specular: 0x009900,
      shininess: 20
    });
    
    console.log(geometry);
    console.log(geometry.attributes);
    console.log(Object.keys(geometry.attributes));
    
    const body = new THREE.Mesh(geometry, material);
    player.add(body);

    player.add(camera);
    player.position.set(2, 0, 2); // half the height of the player
    camera.position.set(0, 3, 10); // eye height

    const textureLoader = new THREE.TextureLoader();
    
    textureLoader.load(
      'https://s3-us-west-2.amazonaws.com/s.cdpn.io/53148/4268-bump.jpg',
      function (texture: THREE.Texture) {
    
        // repeat texture
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
    
        // assign to existing material
        material.bumpMap = texture;
        material.bumpScale = 0.2;
        material.needsUpdate = true;  
      }
    );

    return player;
}

const raycaster = new THREE.Raycaster();

export function updatePlayer(
  player: THREE.Object3D,
  keys: Record<string, boolean>,
  delta: number
) {
  // rotation first (unchanged)
  if (keys["a"]) player.rotation.y += ROTATION_SPEED * delta;
  if (keys["d"]) player.rotation.y -= ROTATION_SPEED * delta;

  // movement direction (forward vector)
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(player.quaternion);

  const moveDistance = SPEED * delta;

  let direction = new THREE.Vector3();

  if (keys["w"]) direction.add(forward);
  if (keys["s"]) direction.sub(forward);

  if (direction.length() === 0) return;

  direction.normalize();

  // raycast collision check
  raycaster.set(player.position, direction);
  raycaster.far = moveDistance + PLAYER_SIZE / 2;

  const hits = raycaster.intersectObjects(walls);

  if (hits.length === 0) {
    player.position.addScaledVector(direction, moveDistance);
  }
}