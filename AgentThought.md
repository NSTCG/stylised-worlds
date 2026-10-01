Let me analyze the requests:

Fixed Foveated Rendering for WebXR - Need to enable renderer.xr.setFoveation(1) for maximum foveation on Quest 2
Fix fog on props - The props (GLB models from whisperingValleyScene.js) need to have the same atmospheric fog applied as terrain and grass. Currently hookAtmosphericFogToScene runs once at startup, but props loaded later (via buildWhisperingValley which runs after 600ms timeout) won't have the fog applied.
Hull outline + fog ordering - If hull outline is enabled, fog should render after the outline
Fog color matching sky horizon - The fog color needs to exactly match the sky shader's horizon color, since right now fog.color is set separately from the uHorizon value used in the sky gradient.
I'm checking main.js/vr.js for where to add the foveation call, and looking at environment.js to see how the fog hook is structured so I can extend it to cover late-loaded props.

The real problem with #2 is that Whispering Valley props load 600ms after hookAtmosphericFogToScene already ran, so they never get the fog shader injection. I'm considering either re-hooking fog after the valley builds, or making setupModelMaterials in materialFeatures.js apply fog automatically. I also want to trace how the two fog layers interact - the built-in FogExp2 versus the custom atmospheric fog uniforms.

So they'd get the shader chunk but not the uniform bindings, meaning the fog would render incorrectly. I'm weighing whether to call hookAtmosphericFogToScene after building the valley, or have whisperingValleyScene.js apply the fog to its own materials directly - checking what setupModelMaterials from materialFeatures.js does to see if that's the right place to hook it in.

Since buildWhisperingValley is async and lives in a separate file from hookAtmosphericFogToScene, I need to either import the fog function into whisperingValleyScene.js or await the valley build in main.js and call the fog hook afterward. I also want to check the hull outline and fog ordering logic in environment.js to make sure they interact correctly.

fog, which is backwards - fog should blend outline edges into the sky rather than having the outline darken already-fogged geometry. The fix is to move the outline injection to run before fog_fragment instead of at dithering_fragment, so outlines get properly faded by distance fog rather than applied on top of it.

Right, so the outline injection happens just before dithering, which fires after fog is applied — I need to move it to inject before the fog include instead so fog properly composites on top.

For the fog-matching-sky issue, the horizon color at h=0 is used directly for fog, but additional sunset/moonlight lerps applied afterward pull the fog color away from that pure horizon value, breaking the match.

I'm also checking whether the atmospheric fog shader's direction-dependent horizon-to-zenith blend actually aligns with the sky's own blend formula, since both use the same power curve and should theoretically converge at the horizon.

But comparing the two, I notice they compute the vertical blend factor h differently — the fog remaps it with a different offset and scale than the sky's clamp range, so they're not actually consistent despite using the same mix formula.

That extra offset explains why the horizon isn't pure horizon color in the fog — it's got zenith mixed in even when looking straight at the horizon. The fix is to align the fog's direction-to-color mapping exactly with the sky shader's formula, and I should also reconsider whether the sun/moon glow scattering belongs in distant fog at all.

Re-reading the user's request, they want the fog to blend seamlessly into the base sky gradient (horizon/zenith) but exclude the discrete sun/moon disks and corona — those are separate celestial elements, not ambient sky color. So the fog shader fix needs to match the h computation to the sky exactly, while keeping the sun/moon forward-scattering glow as a separate atmospheric effect layered on top of that base color match.

Since dirFogColor overrides the built-in fog color for atmospheric materials, the base fogColor uniform only matters for materials without that shader chunk applied. So my plan is: add fixed foveated rendering in main.js, then make sure fog gets reapplied to dynamically-added props like the valley scene and upgrade button after they're built.

I need to await buildWhisperingValley since it's async, then call hookAtmosphericFogToScene right after both that build and the upgradeValleyPrototypesToMesh click handler finish. Next I want to check the ordering in applyAtmosphericFog to make sure outlines get applied before fog.

Now I'm switching the outline injection point from the dithering fragment to the fog fragment, and fixing the h calculation in fog_fragment so it matches the sky_fragment's color exactly. Let me look at the current lines in environment.js to find where the fog fragment shader chunk needs editing.

Editing fog shader...

Adding moon glow scattering...

Now I'm comparing this against the sky shader's gradient logic to make sure the fog calculation matches the horizon clamping exactly.

I also need to include the below-horizon blend that darkens toward the horizon color, so the fog transition matches the sky perfectly. Now I need to apply these changes across main.js (foveation and re-hooking fog after valley construction) and environment.js (fixing the fog height formula and outline ordering), and I should verify whether the fog hook function is already imported in main.js.

Checking the import statement confirms it's already there, so I don't need to add anything new. Now I'm tracing through the current line numbers in environment.js to locate the fog_fragment shader chunk after my earlier edits reduced the sky range and adjusted shadow maps—since I didn't touch the ShaderChunk override section, those lines should be unaffected. I also want to check how the atmosphere view direction varying is computed in the vertex shader portions to make sure it stays consistent with the fragment shader changes.

Looking more carefully, I realize this direction is computed in view space by projecting the position onto each view matrix axis—but that's a problem, since the sky shader uses world-space direction for its calculations. The y-component in view space doesn't correspond to world-space up, so the fog won't align properly with the sky unless I fix this mismatch.

Since the view matrix's rotation is orthogonal, its transpose equals its inverse, so dotting mvPosition against the columns of viewMatrix effectively reconstructs the world-space direction from the view-space one, giving the correct transform back to world space.

So vAtmosphereViewDir normalized is indeed the world-space direction from camera to fragment, and its y component is the vertical world-space value the fog calculation needs. That confirms the fog color should reuse the same height-based mixing function as the sky, blending between horizon and zenith colors using a clamped, power-curved vertical component.

Now I'm turning to the outline rendering order issue. Currently the outline code gets injected before the dithering include, but I need to check where it sits relative to the opaque, tonemapping, colorspace, and fog includes in the standard Three.js fragment shader chain.

Since fog runs before dithering, I want the outline to render before fog instead of after, so I'll move the injection point to right before the fog include rather than dithering.

Now I'm mapping out the exact edits needed in environment.js, starting with fixing the fog height formula at line 54.

For main.js, I'm adding foveation to the renderer after setup, and updating the fog re-hooking logic to await the valley build completion and also trigger after the upgrade button click. I'm double-checking line numbers against my earlier environment.js edits to make sure the replacements still align correctly.

Checking exact line content...

Finishing the outline color blend and swapping the shader include target to fog_fragment. I also need to update main.js to add foveation after setting tone mapping exposure, and make the valley-building timeout async so it can await the build function properly.

After that, I want the fog hook attached once the whispering valley finishes building, and I need to apply the same async pattern to the upgrade-models button handler so fog gets reapplied after the mesh upgrade completes. I'm also about to check the whispering valley button handler for the same treatment.

Wiring up the shared atmospheric uniforms...

Also adding the fragment outline uniform, then I'm reconsidering the injection point and switching it from the dithering stage to the fog fragment stage instead.

Applying outline before fog ensures fog properly fades outlined edges with distance, and the variables needed for the edge calculation are already available at that point in the shader. Since the fog uniforms are bound globally, all materials will pick up the modified fog behavior automatically.

If uniforms are unbound and default to zero, the horizon check fails and falls back gracefully to the default fog color — which is why hookAtmosphericFogToScene must actually run after props load to bind real values. I'm now worried about re-hooking materials that already went through this process, but the check for an existing marker in the fragment shader should prevent duplicate onBeforeCompile callbacks from stacking.

Now I'm preparing the actual edits: a multi-replace for environment.js covering the fog formula and outline ordering, and another for main.js covering foveation and fog re-hooking. Locating the exact fog formula section in environment.js...

Writing shader replacement logic...

Writing edge outline shader logic...

Now shifting to main.js, I need to add foveation settings after the pixel ratio and tone mapping exposure lines, then check the whisperingValleyBtn click handler that builds the Whispering Valley scene.

I still need to update the upgradeValleyModelsBtn handler and the auto-build setTimeout that calls buildWhisperingValley on load, and I've confirmed hookAtmosphericFogToScene is already imported into main.js so no import changes are needed there.

Now I'm preparing to apply the edits as two multi-replace calls, one for environment.js and one for main.js, making sure the line numbers I traced earlier still match since my previous main.js edits didn't shift any lines. Adjusting the fog height formula...

The user's other edits were just value changes, not line insertions, so line numbers should still hold. I'm confirming the antialias and pixel ratio changes don't shift line counts, then planning to insert the foveation code right after the tone mapping exposure setting, before the renderer gets appended to the DOM.

Since WebGLRenderer initializes xr as a WebXRManager right in its constructor, renderer.xr is available immediately, so calling setFoveation works right away without waiting for an XR session. Now I'm ready to write out all the edits.

Delete 

      float h = clamp(d.y * 1.5 + 0.15, 0.0, 1.0);
      dirFogColor = mix(uAtmoHorizon, uAtmoZenith, pow(h, 0.52));

add

float h = clamp(d.y, -0.15, 1.0);
      dirFogColor = mix(uAtmoHorizon, uAtmoZenith, pow(max(h, 0.0), 0.52));
      dirFogColor = mix(dirFogColor, uAtmoHorizon * 0.96, smoothstep(0.04, -0.15, h));