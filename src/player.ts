import * as THREE from 'three';
import { SPEED, ROTATION_SPEED, PLAYER_SIZE } from './constants';
import type { MapSystem } from './map';

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
const HALF = PLAYER_SIZE / 2;

function collidesAt(mapSystem: MapSystem, x: number, z: number): boolean {
  return (
    mapSystem.isWall(x - HALF, z - HALF) ||
    mapSystem.isWall(x + HALF, z - HALF) ||
    mapSystem.isWall(x - HALF, z + HALF) ||
    mapSystem.isWall(x + HALF, z + HALF)
  );
}

export function updatePlayer(
  player: THREE.Object3D,
  mapSystem: MapSystem,
  keys: Record<string, boolean>,
  delta: number
) {
  if (keys["a"]) player.rotation.y += ROTATION_SPEED * delta;
  if (keys["d"]) player.rotation.y -= ROTATION_SPEED * delta;

  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(player.quaternion);

  const moveDistance = SPEED * delta;
  let direction = new THREE.Vector3();

  if (keys["w"]) direction.add(forward);
  if (keys["s"]) direction.sub(forward);

  if (direction.length() === 0) return;

  direction.normalize();
  const movement = direction.clone().multiplyScalar(moveDistance);

  const nextX = player.position.x + movement.x;
  const nextZ = player.position.z + movement.z;

  if (!collidesAt(mapSystem, nextX, player.position.z)) {
    player.position.x = nextX;
  }

  if (!collidesAt(mapSystem, player.position.x, nextZ)) {
    player.position.z = nextZ;
  }
}