import * as THREE from 'three';

export function createWorld(scene: THREE.Scene, layout: string[]) {
  const width = layout[0]?.length ?? 0;
  const height = layout.length;
  const floorGeo = new THREE.PlaneGeometry(width, height);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xc9d3d8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, -0.5, height / 2);
  scene.add(floor);

  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

  let wallCount = 0;
  for (const row of layout) {
    for (const cell of row) {
      if (cell === '1') wallCount++;
    }
  }

  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  const matrix = new THREE.Matrix4();
  let index = 0;

  for (let z = 0; z < layout.length; z++) {
    for (let x = 0; x < layout[z].length; x++) {
      if (layout[z][x] === '1') {
        matrix.setPosition(x + 0.5, 0, z + 0.5);
        walls.setMatrixAt(index, matrix);
        index++;
      }
    }
  }

  scene.add(walls);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(5, 10, 5);
  scene.add(light);
}
