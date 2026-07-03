import * as THREE from 'three';
import { firstMap } from "./map";

export const walls: THREE.Mesh[] = [];

export function createWorld(scene: THREE.Scene, map: string[] = firstMap) {
  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

  for (let z = 0; z < map.length; z++) {
    for (let x = 0; x < map[z].length; x++) {
      if (map[z][x] === "1") {
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(x + 0.5, 0, z + 0.5);

        scene.add(wall);
        walls.push(wall);
      }
    }
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(5, 10, 5);
  scene.add(light);
}
