import express from 'express';
import GuestSession from '../../models/GuestSession.js';

const router = express.Router();

// GET /api/admin/guests?limit=50&search=
// Aggregates GuestSession by email — returns unique guests with party count + contact info
router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const search = (req.query.search || '').trim();

  try {
    // Build match stage
    const matchStage = {};
    if (search) {
      matchStage.$or = [
        { email: { $regex: search, $options: 'i' } },
        { guestName: { $regex: search, $options: 'i' } }
      ];
    }

    const pipeline = [
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: { $toLower: '$email' },
          name:        { $first: '$guestName' },
          emoji:       { $first: '$guestEmoji' },
          phone:       { $first: '$phone' },
          instagram:   { $first: '$instagram' },
          photo:       { $first: '$guestPhoto' },
          partyCodes:  { $addToSet: '$partyCode' },
          lastSeenAt:  { $max: '$joinedAt' },
          firstSeenAt: { $min: '$joinedAt' },
          sessionCount: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          email:        '$_id',
          name:         1,
          emoji:        1,
          phone:        1,
          instagram:    1,
          photo:        1,
          partiesCount: { $size: '$partyCodes' },
          partyCodes:   1,
          lastSeenAt:   1,
          firstSeenAt:  1,
          sessionCount: 1
        }
      },
      { $sort: { lastSeenAt: -1 } },
      { $limit: limit }
    ];

    // Total count (without limit) for pagination info
    const countPipeline = [
      ...(Object.keys(matchStage).length ? [{ $match: matchStage }] : []),
      { $group: { _id: { $toLower: '$email' } } },
      { $count: 'total' }
    ];

    const [guests, countResult] = await Promise.all([
      GuestSession.aggregate(pipeline),
      GuestSession.aggregate(countPipeline)
    ]);

    const total = countResult[0]?.total || 0;

    res.json({ guests, total });
  } catch (err) {
    console.error('[Admin] ❌ guests aggregation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
