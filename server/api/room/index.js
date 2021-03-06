const router = require('express').Router()
const Sandbox = require('sandbox')
const {
  Room,
  Parameters,
  Mutations,
  Selections,
  RoomMutations
} = require('../../db/models')
const { genPop } = require('../../utils/tasks')

module.exports = router

const sandbox = new Sandbox()

router.get('/all', (req, res, next) => {
  Room.findAll()
    .then(rooms => res.json(rooms))
    .catch(next)
})

router.get('/:roomHash', (req, res, next) => {
  return Room.getRoomWithAssociations(
    req.params.roomHash,
    Parameters,
    Selections,
    Mutations
  )
    .then(room => res.json(room))
    .catch(next)
})

router.post('/', (req, res, next) => {
  if (req.body.fitnessFunc) {
    /*
       It is considered malicious to create a Room with a fitness function
       We want to avoid implementing sandbox here so we forbid the
       The behavior completely.
    */
    const err = new Error('You tried to create a Room with a fitness function.')
    err.status = 403
    next(err)
  } else {
    const newRoom = Object.assign({}, req.body, { userId: req.user.id })
    Room.create(newRoom)
      .tap(async (room) => {
        await room.createParameter()
        await room.addMutation(1)
      })
      .then(room => res.json({ roomHash: room.roomHash }))
      .catch(next)
  }
})
router.put('/:roomHash', (req, res, next) => {
  const {
    parameters,
    mutations,
    selection,
    fitnessFunc,
  } = req.body

  const { chromosomeLength, populationSize, genePool } = parameters
  const c = genPop(chromosomeLength, populationSize, genePool)[0]

  sandbox.run(
    `let fitFunc = eval(${fitnessFunc});
    (() => fitFunc([${c})])()`,
    (output) => {
      const isValid = !isNaN(Number(output.result))
      console.log(output.result, isValid)
      // FIXME: re-add security
      if (true) {
        return Room.update(
          {
            fitnessFunc,
            // You can pass a whole selection object or an id.
            selectionId: selection.id ? selection.id : selection
          },
          {
            where: { roomHash: req.params.roomHash },
            returning: true, // needed for affectedRows to be populated
            plain: true // makes sure that the returned instances are just plain objects
          }
        )
          .spread(async (numberOfRows, room) => {

            if (parameters) {
              await Parameters.update(parameters, {
                where: { id: parameters.id }
              })
            }

            if (mutations) {
              await Promise.all(mutations.map(async (mutation) => {
                await RoomMutations
                  .upsert({
                    chanceOfMutation: Number(mutation.chanceOfMutation),
                    roomId: room.id,
                    mutationId: mutation.id
                  })
              }))
            }
          }).then(() => {
            return Room.getRoomWithAssociations(
              req.params.roomHash,
              Parameters,
              Selections,
              Mutations
            )
              .then(room => res.status(201).json(room))
          })
          .catch(next)
      } else {
        res.status(403).send(output.result)
      }
    }
  )
})
