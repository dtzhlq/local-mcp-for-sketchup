model.units = "inches"
model.reset()

camera = Camera(
    SUPoint3D(8, -10, 6),
    SUPoint3D(0, 0, 1),
    fov=42,
)
camera.look_at(SUPoint3D(1, 1, 1))
model.set_camera(camera)

scene = Scene("SDK_View_Scene", camera=camera)
model.add_scene(scene)

style = Style(
    "SDK_View_Style",
    display_edges=True,
    profiles=True,
    profile_width=2,
    face_style="shaded_with_textures",
    background_color=SUColor("#f7f4ed"),
    sky_color="#cfe8ff",
    ground_color="#ded8c8",
)
model.set_style(style)

shadow = ShadowInfo(
    display=True,
    time="2026-06-25T10:00:00+08:00",
    light=80,
    dark=35,
    use_sun_for_shading=True,
)
model.set_shadow(shadow)

rendering = RenderingOptions(
    edge_display_mode=1,
    draw_hidden_geometry=False,
    transparency=True,
    background_color="#ffffff",
)
model.set_rendering_options(rendering)

result = {
    "scene_name": scene.name,
    "camera_target_source_units": camera.target,
    "style_name": style.options["name"],
    "shadow_light": shadow.options["light"],
    "rendering_edge_display_mode": rendering.options["edge_display_mode"],
}
