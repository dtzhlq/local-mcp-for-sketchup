model.units = "inches"
model.reset()

guide = Curve(
    "SDK_Curve_Object",
    [
        SUPoint3D(0, 0, 0),
        SUPoint3D(1, 0.5, 0),
        SUPoint3D(2, 0, 0),
    ],
    id="sdk-curve-object",
)
arc = ArcCurve(
    "SDK_Arc_Object",
    SUPoint3D(0, 0, 1),
    1.5,
    start_angle=0,
    end_angle=180,
    segments=8,
    plane="xy",
    id="sdk-arc-object",
)

model.add_curve(guide)
model.add_arc_curve(arc)

result = {
    "curve_points": guide.point_count,
    "arc_segments": arc.segments,
}
