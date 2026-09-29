import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mixamoVRMRigMap } from './mixamoVRMRigMap.js';

/**
 * Load Mixamo animation, convert for three-vrm use, and return it.
 * Source: https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/humanoidAnimation/loadMixamoAnimation.js
 *
 * @param {string | object} urlOrAsset A url of mixamo animation data or a loaded 3D asset/scene
 * @param {VRM} vrm A target VRM
 * @param {string} [clipName='mixamo.com'] The name of the animation clip to find in the asset
 * @returns {Promise<THREE.AnimationClip>} The converted AnimationClip
 */
export function loadMixamoAnimation( urlOrAsset, vrm, clipName = 'mixamo.com' ) {

	const processAsset = ( asset ) => {
		const rootNode = asset.scene || asset;
		const animations = asset.animations || (asset.scene && asset.scene.animations) || (Array.isArray(asset) ? asset : []);

		let clip = null;
		if ( clipName && typeof clipName === 'object' && clipName.tracks ) {
			clip = clipName;
		} else if ( typeof clipName === 'string' ) {
			clip = THREE.AnimationClip.findByName( animations, clipName ) ||
				animations.find( ( c ) => c.name.toLowerCase() === clipName.toLowerCase() ) ||
				animations.find( ( c ) => c.name.toLowerCase().includes( clipName.toLowerCase() ) );
		}
		if ( !clip && animations.length > 0 ) {
			clip = animations[ 0 ];
		}
		if ( !clip ) {
			throw new Error( `Mixamo clip "${typeof clipName === 'string' ? clipName : 'target'}" not found in asset` );
		}

		const tracks = []; // KeyframeTracks compatible with VRM will be added here

		const restRotationInverse = new THREE.Quaternion();
		const parentRestWorldRotation = new THREE.Quaternion();
		const _quatA = new THREE.Quaternion();
		const _vec3 = new THREE.Vector3();

		// Adjust with reference to hips height.
		const motionHips = rootNode.getObjectByName( 'mixamorigHips' ) || rootNode.getObjectByName( 'mixamorig:Hips' );
		const motionHipsHeight = motionHips ? motionHips.position.y : 100.0;
		const vrmHipsHeight = vrm.humanoid?.normalizedRestPose?.hips?.position?.[ 1 ] || 0.85;
		const hipsPositionScale = motionHipsHeight > 0.001 ? ( vrmHipsHeight / motionHipsHeight ) : 1.0;

		clip.tracks.forEach( ( origTrack ) => {

			const track = origTrack.clone();

			// Convert each tracks for VRM use, and push to `tracks`
			const trackSplitted = track.name.split( '.' );
			const mixamoRigName = trackSplitted[ 0 ];
			const vrmBoneName = mixamoVRMRigMap[ mixamoRigName ] || mixamoVRMRigMap[ mixamoRigName.replace( ':', '' ) ];
			const vrmNodeName = vrm.humanoid?.getNormalizedBoneNode( vrmBoneName )?.name;
			const mixamoRigNode = rootNode.getObjectByName( mixamoRigName );

			if ( vrmNodeName != null && mixamoRigNode != null ) {

				const propertyName = trackSplitted[ 1 ];

				// Store rotations of rest-pose.
				mixamoRigNode.getWorldQuaternion( restRotationInverse ).invert();
				if ( mixamoRigNode.parent ) {
					mixamoRigNode.parent.getWorldQuaternion( parentRestWorldRotation );
				} else {
					parentRestWorldRotation.identity();
				}

				if ( track instanceof THREE.QuaternionKeyframeTrack ) {

					// Retarget rotation of mixamoRig to NormalizedBone.
					for ( let i = 0; i < track.values.length; i += 4 ) {

						const flatQuaternion = track.values.slice( i, i + 4 );

						_quatA.fromArray( flatQuaternion );

						// 親のレスト時ワールド回転 * トラックの回転 * レスト時ワールド回転の逆
						_quatA
							.premultiply( parentRestWorldRotation )
							.multiply( restRotationInverse );

						_quatA.toArray( flatQuaternion );

						flatQuaternion.forEach( ( v, index ) => {

							track.values[ index + i ] = v;

						} );

					}

					tracks.push(
						new THREE.QuaternionKeyframeTrack(
							`${vrmNodeName}.${propertyName}`,
							track.times,
							track.values.map( ( v, i ) => ( vrm.meta?.metaVersion === '0' && i % 2 === 0 ? - v : v ) ),
						),
					);

				} else if ( track instanceof THREE.VectorKeyframeTrack ) {

					const value = track.values.map( ( v, i ) => ( vrm.meta?.metaVersion === '0' && i % 3 !== 1 ? - v : v ) * hipsPositionScale );
					tracks.push( new THREE.VectorKeyframeTrack( `${vrmNodeName}.${propertyName}`, track.times, value ) );

				}

			}

		} );

		return new THREE.AnimationClip( `vrm_${clip.name || 'Animation'}`, clip.duration, tracks );
	};

	if ( typeof urlOrAsset === 'string' ) {
		const isGLTF = urlOrAsset.toLowerCase().endsWith( '.glb' ) || urlOrAsset.toLowerCase().endsWith( '.gltf' );
		if ( isGLTF ) {
			return import( 'three/addons/loaders/GLTFLoader.js' ).then( ( { GLTFLoader } ) => {
				return new Promise( ( resolve, reject ) => {
					new GLTFLoader().load( urlOrAsset, ( gltf ) => resolve( processAsset( gltf ) ), undefined, reject );
				} );
			} );
		} else {
			const loader = new FBXLoader();
			return loader.loadAsync( urlOrAsset ).then( ( asset ) => processAsset( asset ) );
		}
	} else {
		return Promise.resolve( processAsset( urlOrAsset ) );
	}
}
