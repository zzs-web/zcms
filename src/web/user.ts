import { FastifyPluginAsync } from 'fastify'
import { Db, FilterQuery, ObjectId, UpdateQuery } from 'mongodb'
import { getCollections, IUserDoc } from '../db'
import { DI, generatePasswordPair, isObjectId, K_DB } from '../utils'
import {
  ObjectIdOrSlugSchema,
  ObjectIdSchema,
  paginationResult,
  S,
  UserDTO
} from './common'

export const userPlugin: FastifyPluginAsync = async (V) => {
  const db = await DI.waitFor<Db>(K_DB)
  const { Users, Posts } = getCollections(db)

  V.get(
    '/',
    {
      preValidation: [V.auth.admin],
      schema: {
        querystring: S.object()
          .prop('page', S.integer().minimum(1).required())
          .prop('per_page', S.integer().minimum(1).maximum(50).required()),
        response: {
          200: paginationResult(UserDTO)
        }
      }
    },
    async (req) => {
      const { query: qs } = <any>req
      const { page, per_page } = qs

      const query: FilterQuery<IUserDoc> = {}
      const total = await Users.countDocuments(query)
      const skip = (page - 1) * per_page
      if (skip && skip >= total) throw V.httpErrors.notFound()

      const users = await Users.find(query, {
        projection: { pass: 0, oauth: 0 }
      })
        .skip(skip)
        .limit(per_page)
        .toArray()
      return {
        items: users,
        total: total
      }
    }
  )

  V.get(
    '/:idOrSlug',
    {
      schema: {
        params: ObjectIdOrSlugSchema,
        response: {
          200: UserDTO
        }
      }
    },
    async (req) => {
      const { params } = <any>req
      const user = await Users.findOne(
        isObjectId(params.idOrSlug)
          ? { _id: new ObjectId(params.idOrSlug) }
          : { slug: params.idOrSlug },
        { projection: { pass: 0 } }
      )
      if (!user) throw V.httpErrors.notFound()
      return user
    }
  )

  V.post(
    '/',
    {
      schema: {
        body: S.object()
          .prop('slug', S.string().minLength(3).required())
          .prop('name', S.string().minLength(3).required())
          .prop('email', S.string().required())
          .prop(
            'perm',
            S.object()
              .required()
              .prop('admin', S.boolean())
              .prop('comment', S.boolean())
          )
          .prop('pwd', S.string().required())
      },
      preValidation: [V.auth.admin]
    },
    async (req) => {
      const { body } = <any>req
      const { slug, name, email, pwd, perm } = body
      const pass = await generatePasswordPair(pwd)
      const r = await Users.insertOne({
        slug,
        name,
        email,
        pass,
        perm,
        oauth: {}
      })
      return r.insertedId
    }
  )

  V.put(
    '/:id',
    {
      schema: {
        params: ObjectIdSchema,
        body: S.object()
          .prop('name', S.string().minLength(3).maxLength(20))
          .prop('email', S.string().pattern(/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/))
          .prop('pass', S.string().minLength(6))
      },
      preValidation: [V.auth.login]
    },
    async (req) => {
      const { params, body } = <any>req
      const _id = new ObjectId(params.id)
      if (!req.ctx.user!.perm.admin && !_id.equals(req.ctx.user!._id)) {
        throw V.httpErrors.forbidden()
      }

      const update: any = {
        $set: {}
      }
      if ('name' in body) {
        update.$set.name = body.name
      }
      if ('email' in body) {
        update.$set.email = body.email
      }
      if ('pass' in body) {
        update.$set.pass = await generatePasswordPair(body.pass)
      }

      await Users.updateOne({ _id }, update)
      return true
    }
  )

  V.delete(
    '/:id',
    {
      schema: { params: ObjectIdSchema },
      preValidation: [V.auth.admin]
    },
    async (req) => {
      const { params } = <any>req
      const _id = new ObjectId(params.id)
      await Users.deleteOne({ _id })
      return true
    }
  )
}
