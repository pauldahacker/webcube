import * as THREE from 'three';
import { SPEED, ROTATION_SPEED } from './constants';

export function createPlayer(camera: THREE.Camera) {
    const player = new THREE.Object3D();
    const geometry = new THREE.BoxGeometry(3, 3, 3);
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

export function updatePlayer(player: THREE.Object3D, keys: Record<string, boolean>, delta: number) {
    if (keys["w"]) player.translateZ(-SPEED * delta);
    if (keys["s"]) player.translateZ(SPEED * delta);
    if (keys["a"]) player.rotation.y += ROTATION_SPEED * delta;
    if (keys["d"]) player.rotation.y -= ROTATION_SPEED * delta;
}