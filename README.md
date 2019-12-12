# 逐行解析Vuex源码

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新。
![vuex组成](https://vuex.vuejs.org/vuex.png)
Vuex，在全局有一个state存放数据，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用，获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，action同样不能直接修改state，要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化。

看源码之前再看一遍[Vuex文档](https://vuex.vuejs.org/zh/)会加深理解，建议抽空过一遍。

## Vuex的安装

Vuex 是 Vue 插件，在使用Vuex前，必须通过 Vue.use() 来安装 Vuex，并且需要在调用 new Vue() 之前调用：

```js
import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(vuex);

new Vue({
  // ...组件选项
})
```
>Vue.use(plugin) 用来安装Vue插件
>如果插件是一个对象，它必须提供 install 方法。如果插件是一个函数，则它被作为 install 方法。install 接收的第一个参数就是 Vue 对象
>Vue.use 需要在调用 new Vue() 之前被调用

src\index.js 入口文件中，Vuex 导出默认对象中有 install 方法：

```js
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
```

Vue.use执行时，会调用 install。我们看 `install` 方法。

```js
let Vue
// ....
export function install (_Vue) {
  if (Vue && _Vue === Vue) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[vuex] already installed. Vue.use(Vuex) should be called only once.')
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
```

如果是初次调用install，Vue不存在，if语句块不执行，install接收的_Vue，即Vue构造函数，赋给Vue。如果再次调用install，Vue已经有值，且和传入的_Vue全等，则开发环境下会打印警告：“Vuex已经安装了，Vue.use(Vuex)只能调用一次”，然后直接返回，避免了Vuex插件的重复安装。

然后调用applyMixin(Vue)，我们看看 src\mixin.js 中的 applyMixin 函数：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x 的处理，不做分析
  }
  function vuexInit () {
    // store 注入
  }
}
``` 

真正的install是在 applyMixin 中，如果Vue的版本是2.x，调用Vue.mixin，混入一个beforeCreate钩子：vuexInit。Vue.mixin的作用是：全局注册一个混入，会影响之后创建的每个 Vue 实例。

这意味着，install之后，创建的每个Vue实例的执行beforeCreate钩子函数时，都会执行vuexInit。

vuexInit顾名思义是初始化 vuex ，看看它的实现：

```js
function vuexInit () {
  const options = this.$options
  if (options.store) {
    this.$store = typeof options.store === 'function'
      ? options.store()
      : options.store
  } else if (options.parent && options.parent.$store) {
    this.$store = options.parent.$store
  }
}
```

vuexInit执行时，this 指向当前 Vue 实例，this.$options 获取的是当前 Vue 实例的$options对象。

如果 this.$options.store 存在，说明实例化 Vue 时传入了store这个配置项。我们只有在创建Vue的根实例时，才会传入store对象，即如下：

```js
new Vue({
  store,
  router,
  render: h => h(App)
}).$mount('#app')
```

所以如果 this.$options.store 存在，说明当前实例是根实例，给根实例添加$store属性，属性值为options.store()或options.store；如果当前不是根Vue实例，再判断，如果它有父实例，并且父实例有$store值，则也给当前实例添加$store属性，属性值为父组件的$store值。

所以 applyMixin 让每一个Vue组件实例的创建，执行到 beforeCreate 钩子时都会调用 vuexInit，并且，所有Vue组件实例的$store属性都指向同一个store对象，即在任意组件中都可以通过this.$store访问根实例中注册的store对象

## store 对象的创建

可见，根实例注册的 store 对象会向下注入到子组件实例中。问题来了，这个 store 对象是怎么创建的

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```

Vuex默认导出的对象中有Store这个构造函数，对它的实例化返回出store实例。Store构造函数接收一个选项对象，包含actions、getters、state、mutations、modules等。

接下来我们看看 Store 这个构造函数。代码较长，我们拆分成几段来看：

```js
class Store {
  constructor(options = {}) {
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }
    // ……
  }
  // ……
}
```

首先判断，如果 Vue 没有值，且当前是浏览器环境，且 window 上有 Vue ，说明没有调用过install，就传入 window.Vue 执行 install 方法，这是一种属于Vuex的主动安装。

然后是开发环境中，执行3个断言函数，判断是否具备使用Vuex的必要条件。

assert函数是一个简单的断言函数的实现。

```js
export function assert (condition, msg) {
  if (!condition) throw new Error(`[vuex] ${msg}`)
}
```

1. 如果Vue没有值，抛出错误：实例化 Store 之前必须调用Vue.use(Vuex)，这样Vue变量才能是Vue构造函数，后面会用到
2. 如果Promise不能用，也会抛出错误：Vuex 依赖 Promise。
3. 如果 Store 函数里的 this 不是 Store 的实例，抛出错误： Store 必须用 new 字符调用

环境判断后，初始化一些store实例的属性，代表内部状态：

```js
const { plugins = [], strict = false } = options
this._committing = false // 提交mutation状态的标志
this._actions = Object.create(null) // 存放actions
this._actionSubscribers = [] // action 订阅函数集合
this._mutations = Object.create(null) // 存放mutations
this._wrappedGetters = Object.create(null) // 存放getters
this._modules = new ModuleCollection(options) // module收集器
this._modulesNamespaceMap = Object.create(null) // 模块命名空间
this._subscribers = [] // 存储所有对mutation变化的订阅者
this._watcherVM = new Vue() // Vue实例
this._makeLocalGettersCache = Object.create(null)//存放生成的本地getters的缓存
```

strict模式默认为false，如果实例化Store时传了strict:true，进入严格模式，任何 mutation 处理函数以外修改 Vuex state 都会抛出错误。

暂时我们不用管每个具体是什么含义。其中的重点是：

 `this._modules = new ModuleCollection(options)`
 
稍后会详细介绍。接下来继续看 constructor ：

```js
const store = this
const { dispatch, commit } = this
this.dispatch = function boundDispatch (type, payload) {
  return dispatch.call(store, type, payload)
}
this.commit = function boundCommit (type, payload, options) {
  return commit.call(store, type, payload, options)
}
```

首先定义 store 变量指向当前 store 实例。再解构出 Store 的原型上的 dispatch 、commit 方法，赋给了变量dispatch、commit，接着给 store 实例添加dispatch和commit方法，它们分别相当于指定了this为当前store实例的dispatch和commit原型方法。

现在 store 实例对象上就有了 dispatch 和 commit 两个方法，store调用它们时就不会访问原型上的方法，具体它们做了什么，后面会讲。

接着看 constructor

```js
this.strict = strict
const state = this._modules.root.state
installModule(this, state, [], this._modules.root)
resetStoreVM(this, state)
plugins.forEach(plugin => plugin(this))
// ...省略
```

现在到了 Vuex 初始化的核心部分了，包括了：

1. strict 是从options中解构出来的属性值，将它赋给 store实例的strict属性
2. 由于this._modules = new ModuleCollection(options)，获取根 state 对象赋给变量state
3. 调用 installModule进行模块的注册，传入store实例，state，空数组和new Store时传入的选项对象。
4. 调用resetStoreVM函数，进行state的响应式化处理
5. 遍历plugins数组，进行插件的逐个注册

上面这些我们不知道它具体的实现，只需先了解，后面会展开讲。所以到目前为止，constructor 的代码已经过了一遍。总结一下，Store 函数主要做了三件事：

1. 初始化一些内部属性，其中重点是 this._modules = new ModuleCollection(options)
2. 执行installModule，安装模块
3. 执行resetStoreVM ，使store响应式化

我们将逐个细说这三个，先说初始化 _module 属性，也就是 module 的收集

### Module 收集

```js
this._modules = new ModuleCollection(options)
```

Vuex文档里是这么说：

> store 使用单一的状态树，用一个对象就包含了全部的应用层级的状态，每个应用将仅仅包含一个 store 实例。

如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex 允许我们将 store 切割成 module，每个模块都有自己的 state 、mutation、action、getter、甚至子模块，像下面这样从上至下进行分割：

```js
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}
const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... }
}
const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})
store.state.a // -> moduleA 的状态
store.state.b // -> moduleB 的状态
```

可以看到，module的设计是一个用配置对象描述的树形结构，store 本身可以理解为一个根 module，下面是一些子 module。我们希望将这种树形关系，转成通过父子关系彼此联系的单个对象的存在，即进行 module 的收集

这是通过new ModuleCollection实现，我们看看 `ModuleCollection` 这个构造函数：

```js
class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false)
  }
  register (path, rawModule, runtime = true) {
    // ...
  }
  // ...
}
```
new ModuleCollection(options) 就是执行register原型方法

我们看看 register 这个函数：

```js
register (path, rawModule, runtime = true) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, rawModule)
  }

  const newModule = new Module(rawModule, runtime)
  if (path.length === 0) {
    this.root = newModule
  } else {
    const parent = this.get(path.slice(0, -1))
    parent.addChild(path[path.length - 1], newModule)
  }

  // register nested modules
  if (rawModule.modules) {
    forEachValue(rawModule.modules, (rawChildModule, key) => {
      this.register(path.concat(key), rawChildModule, runtime)
    })
  }
}
```
register 方法，它接收3个参数：

1. path，是module的key组成的数组，作为唯一的路径，区分了不同的module。比如根 store 对象被视为根module，它的path为[]，它的子模块 moduleA 的 path 是 ['a'] ，子模块 moduleB 的 path 是 ['b'] ，如果它们有嵌套的子模块，则它们的 path 就大致形如 ['a','a1'] 、['a','a2'] 、['b','b1']
2. rawModule，是定义当前 module 的options对象，后面我们统一称它为配置对象。像 rawRootModule 就是实例化 Store 时传入的配置镀锡，我们把它看作根module的配置对象。
3. runtime 表示是否是一个运行时创建的 module，默认为 true。

```js
this.register([], rawRootModule, false)
```

new ModuleCollection(options)时，首次调用register，第一个参数传入[]，说明这是注册根module。rawRootModule是实例化Store时传入的配置对象。

我们具体分段看register的内部：

```js
  assertRawModule(path, rawModule)
  const newModule = new Module(rawModule, runtime)
```

首先调用 assertRawModule 对 module 的配置对象作一些判断，遍历用户传的配置对象中的 getters、mutations、actions 是否符合要求，这里不作具体分析。

然后根据当前的配置对象，创建一个Module实例，赋给变量 newModule。

```js
if (path.length === 0) {
  this.root = newModule
} else {
  const parent = this.get(path.slice(0, -1))
  parent.addChild(path[path.length - 1], newModule)
}
```

如果path是空数组，即当前注册的module是根module，把刚刚创建的根 Module 实例赋给 this.root，即 ModuleCollection 的实例的root属性保存了根module对象。

store实例上有_modules属性，指向ModuleCollection实例，ModuleCollection实例有root属性，指向根module对象

当path不是空数组，即当前register函数注册的是子module，稍后讲解。

接下来是的register的最后一段：

```js
if (rawModule.modules) {
  forEachValue(rawModule.modules, (rawChildModule, key) => {
    this.register(path.concat(key), rawChildModule, runtime)
  })
}
```
我们知道配置对象中module可以嵌套自己的子module，所以，注册当前模块时，也要递归注册子模块，即递归调用register。

if 判断，如果当前配置对象 rawModule 有modules，则调用forEachValue遍历modules，我们看看 forEachValue 函数：

```js
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}
```

forEachValue 函数接收对象obj和回调函数fn，遍历 obj 的自有属性key，逐个调用fn。

因此，如果当前模块rawModule存在子模块modules，遍历 rawModule.modules 里的每个key，执行回调fn，传入obj[key]和key，即子模块的配置对象、和子模块配置对象的key名。在fn中调用register函数，对子模块进行注册。

传入register的path是 `path.concat(key)` 。当前的path是当前注册的模块的路径，concat上当前遍历的key，就代表着它的子模块的路径path。

比如模块a嵌套了模块b，模块b嵌套了模块c，那模块c的path就是：['a','b'].concat('c')，即['a','b','c']

传入register的第二个参数rawChildModule，是当前遍历的value值，即子模块的配置对象。

可见，实例化Store必然会实例化MoudleCollection，进行module的收集，必然至少调用一次register，注册根module，如果根配置对象有嵌套的modules，则会继续调用 register，注册子module。在register中，如果path不是空数组，进入那个 else 语句块:

```js
 const parent = this.get(path.slice(0, -1))
 parent.addChild(path[path.length - 1], newModule)
```

path是当前子模块的路径，path.slice(0, -1) 是截去最后一项的数组，它代表当前模块的父模块的path。传入get方法执行，目的是为了获取该当前子模块的父module对象，我们看看get方法：

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

reduce 的详细用法可以参考 [reduce - MDN](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/Reduce)

get方法是 ModuleCollection 的原型方法，我们先看一下 getChild 和 addChild 的实现，再回来理解get。

```js
getChild (key) {
  return this._children[key]
}
addChild (key, module) {
  this._children[key] = module
}
```

getChild 和 addChild 是Module的原型方法，getChild方法返回的是this._children[key]，即key所对应的，当前module的子module对象，我们讲到 Module 这个构造函数时会讲_children这个属性。

addChild方法是给当前module对象的_children属性，添加子模块对象。你可以看到父子module的关系是靠_children属性建立的。

回到 ModuleCollection 的原型方法get

```js
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```
为了方便理解，假设传入get的 path 为['a','b','c']

reduce 累加器的初始值为 this.root，是根module对象，第一次迭代执行回调返回的是：根模块下的key为'a'的子模块对象，并且该值作为下一次迭代的累加器的值，即回调函数的第一个参数module，第二次迭代执行返回'a'模块下的子模块'b'的模块对象，以此类推，最后get函数返回 path 为 ['a','b','c'] 对应的模块。

所以get方法是根据path数组，通过数组的reduce迭代。返回出path对应的module对象。

我们拿到当前模块的父模块对象后，调用addChild方法，给父模块对象的_children属性，添加子模块对象。

```js
 const parent = this.get(path.slice(0, -1))
 parent.addChild(path[path.length - 1], newModule)
```

path数组的最后一项，就是当前模块的名称，newModule为当前模块对象，将它们作为键值对添加到父模块对象的_children属性(对象)中

通过 _children 属性，建立了父模块对象和子模块对象之间的父子关系，这种联系是基于 Module 实例的层面的，不是基于未加工的配置对象层面的。把树形的配置对象结构，转成了一个个散落的父子对象。

我们再整体梳理一下 register方法：

```js
register (path, rawModule, runtime = true) {
  const newModule = new Module(rawModule, runtime)
  if (path.length === 0) {
    this.root = newModule
  } else {
    const parent = this.get(path.slice(0, -1))
    parent.addChild(path[path.length - 1], newModule)
  }
  if (rawModule.modules) {
    forEachValue(rawModule.modules, (rawChildModule, key) => {
      this.register(path.concat(key), rawChildModule, runtime)
    })
  }
}
```

首先 register方法肯定会至少调用一次的，在实例化Store的时候，调用了new ModuleCollection，执行this.register([], rawRootModule, false)。根配置对象被注册为根module对象，只要你配置了嵌套模块，register就会被递归调用，去注册每一个子模块，并且保证每一个子模块都通过 path 去找到自己的父模块对象，然后通过 addChild 建立父子关系，然后再看自己有没有嵌套了子模块，如果有就继续递归调用register，完成了整个 module 树的注册。

我们所说的module对象，模块对象，都指的是 Module 的实例。我们看看Module构造函数

## Module 构造函数

Vuex 的设计者将用户定义的 module 配置对象称为 rawModule(未经加工的配置对象)，传入 new Moudle 执行之后，实现了从 rawModule 到 module 对象的转变。

```js
class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    this._children = Object.create(null)
    this._rawModule = rawModule
    const rawState = rawModule.state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }
  // ...原型方法后续会介绍
}
```
Module的实例会挂载一些属性：比如 _children，属性值为一个空对象，用来存放当前模块对象的子模块对象。 _rawModule 属性，属性值为当前模块的配置对象。state 属性，属性值为该模块配置对象的 state 对象。

现在我们回过头，梳理整个 new ModuleCollection 的过程(register的执行)，包含了两件事：

1. 由 rawModule 配置对象 通过new Module 构建出 module 对象
2. 通过递归调用register，建立父子 module 对象之间的父子联系

new Module 是在 new ModuleCollection 的过程中发生的，先生成了模块对象，再进行模块对象的收集。

### installModule

我们在讲 Store 的 constructor 时，讲了它重点的做的三件事，现在我们讲完了模块对象的创建和建立父子关系，接着就是模块的安装(初始化根模块对象)，也就是 constructor 中的这句：

```js
installModule(this, state, [], this._modules.root)
```

在默认情况下，模块内部的action、mutation 和 getter是注册在全局命名空间的，这样会使得多个模块中的同名mutation 或 action对同一个mutation 或 action作出响应。

Vuex 2.x版本添加了命名空间的功能，使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`。

但默认情况下，模块内部的 action、mutation 和 getter 是注册在全局命名空间的，比如，不同模块有同名的mutation，会导致多个模块能够对同一个 mutation 作出响应。

如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式使其成为带命名空间的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。例如：
如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式使其成为带命名空间的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。例如：
启用了命名空间的 getter 和 action 会收到局部化的 getter，dispatch 和 commit。换言之，你在使用模块内容（module assets）时不需要在同一模块内额外添加空间名前缀。更改 namespaced 属性后不需要修改模块内的代码。

#在带命名空间的模块内访问全局内容（Global Assets）
如果你希望使用全局 state 和 getter，rootState 和 rootGetters 会作为第三和第四参数传入 getter，也会通过 context 对象的属性传入 action。

若需要在全局命名空间内分发 action 或提交 mutation，将 { root: true } 作为第三参数传给 dispatch 或 commit 即可。
我们看installModule的实现：

```js
function installModule(store, rootState, path, module, hot) {
  const isRoot = !path.length // 是否为根module
  const namespace = store._modules.getNamespace(path) // 获取module的namespace
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }
  if (!isRoot && !hot) { // 不为根且非热更新
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
    const moduleName = path[path.length - 1] // module的name
    store._withCommit(() => { // 将子module设置成响应式的
      Vue.set(parentState, moduleName, module.state)
    })
  }
  const local = module.context = makeLocalContext(store, namespace, path)
  module.forEachMutation((mutation, key) => {...}) // 遍历注册mutation
  module.forEachAction((action, key) => {...}) // 遍历注册action
  module.forEachGetter((getter, key) => {...})// 遍历注册getter
  module.forEachChild((child, key) => { // 递归安装module
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```
由Vuex文档可知：

Vuex 2后的版本添加了命名空间的功能，使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`。

但默认情况下，模块内部的 action、mutation 和 getter 是注册在全局命名空间的，比如，不同模块有同名的mutation，会导致多个模块能够对同一个 mutation 作出响应。

如果希望你的模块具有更高的封装度和复用性，你可以通过添加 namespaced: true 的方式使其成为带命名空间的模块。当模块被注册后，它的所有 getter、action 及 mutation 都会自动根据模块注册的路径调整命名。例如：

```js
const store = new Vuex.Store({
  modules: {
    account: {
      namespaced: true,
      state: {}, 
      getters: {
        isAdmin() {...} // -> getters['account/isAdmin']
      },
      actions: {
        login() {...} // -> dispatch('account/login')
      },
      mutations: {
        login() {...} // -> commit('account/login')
      },
      modules: { // 继承父模块的命名空间
        myPage: {
          state: {},
          getters: {
            profile() {...} // -> getters['account/profile']
          }
        },
        posts: {
          namespaced: true,// 进一步嵌套命名空间
          state: {},
          getters: {
            popular() {...} // -> getters['account/posts/popular']
          }
        }
      }
    }
  }
})
```

我们先看 installModule 它接收什么参数：

```js
function installModule(store, rootState, path, module, hot) {
  // 
}
```
store 是 Store实例，就是new Vuex.Store时传入的store对象。rootState是根state对象，path是当前的模块对应的路径数组，module 是当前模块对象，hot代表是否支持热重载（这里不讨论它）

installModule 代码较长，我们分段来看

```js
const isRoot = !path.length
const namespace = store._modules.getNamespace(path)

if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```

首先，使用isRoot变量来标识当前模块是否为根模块，接着，调用 ModuleCollection的原型方法 getNamespace 函数传入path，拿到当前module的namespace值。我们看看getNamespace这个方法。

```js
getNamespace (path) {
  let module = this.root
  return path.reduce((namespace, key) => {
    module = module.getChild(key)
    return namespace + (module.namespaced ? key + '/' : '')
  }, '')
}
```

getNamespace 首先获取到根module对象，然后调用path的reduce方法，沿着path，每次迭代获取到子模块对象module，如果module.namespaced存在，就将上一次执行回调的返回值(类加值)拼上当前的key字符串和'/'，否则拼接''，累加器初始值为''。

通过这样的方式就返回出当前模块的 namespace 字符串。我们称它为命名空间。

```js
if (module.namespaced) {
  if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
  }
  store._modulesNamespaceMap[namespace] = module
}
```
如果当前模块使用了命名空间，再判断，如果store对象的属性_modulesNamespaceMap，这个对象中是否存在该命名空间，如果有，则报错提示：命名空间的名称重复了，如果没有，则将命名空间和它对应的模块对象，作为键值对添加到_modulesNamespaceMap对象中

继续看installModule的代码：

```js
if (!isRoot && !hot) { // 不为根且非热更新
  const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
  const moduleName = path[path.length - 1] // module的name
  store._withCommit(() => { // 将子module设置成响应式的
    Vue.set(parentState, moduleName, module.state)
  })
}
if (!isRoot && !hot) {
  const parentState = getNestedState(rootState, path.slice(0, -1))
  const moduleName = path[path.length - 1]
  store._withCommit(() => {
    if (process.env.NODE_ENV !== 'production') {
      if (moduleName in parentState) {
        console.warn(
          `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
        )
      }
    }
    Vue.set(parentState, moduleName, module.state)
  })
}
```
如果当前模块不是根模块，且非热更新，执行if语句块。

首先，根据根state和父模块的path，通过调用getNestedState函数，获取当前模块的父state

我们快速看一看 getNestedState 的实现：

```js
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}
```

父模块的path调用reduce，累加器的初始值为根state，每次迭代返回出它的子模块的state，沿着path路径，一个个往下获取，直到获取到当前state的父state。就比如`store.state` >> `store.state.a` >> `store.state.a.b`...

`const moduleName = path[path.length - 1]` 获取到当前模块的key名，赋给moduleName

接着调用了Store的原型方法_withCommit，我们先看看_withCommit这个Store的原型方法

```js
_withCommit (fn) {
  const committing = this._committing
  this._committing = true
  fn()
  this._committing = committing
}
```

_withCommit接收一个函数fn，首先把当前store的_committing置为true，然后执行fn，再把 _committing属性值恢复到原来的值。

store._withCommit执行，首先_committing置为true，然后在开发环境中判断，如果当前模块的key名(假定叫value)，和父模块(假定模块名叫a)的state对象中的value冲突，比如，会有这样的问题：当你想获取父模块的state的value属性值时，store.state.a.value，你拿到的却是当前这个子模块value的配置对象，即父模块的state的这个属性被覆盖了，所以要报错提示。

然后执行 `Vue.set(parentState, moduleName, module.state)`，它是修改state的一种内部的合法行为，这个过程_committing为true。所有合法的修改state的操作发生时，都让_committing为true，其他时刻都为false，因此任何非法修改state的动作都会报错警告："do not mutate vuex store state outside mutation handlers."

Vue.set给根state对象添加响应式的子state，响应式属性为模块名，属性值为模块的state。

接下来，注册 mutation 等：

```js
const local = module.context = makeLocalContext(store, namespace, path)

module.forEachMutation((mutation, key) => {
  const namespacedType = namespace + key
  registerMutation(store, namespacedType, mutation, local)
})
```

首先执行makeLocalContext方法，传入store对象，当前模块的命名空间，和当前的模块路径path，返回的值赋给 local 和 module.context。

我们看看 makeLocalContext 的实现：

```js
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''
  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args
      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }
      return store.dispatch(type, payload)
    },
    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args
      if (!options || !options.root) {
        type = namespace + type
        if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }
      store.commit(type, payload, options)
    }
  }
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })
  return local
}
```
makeLocalContext函数中，首先定义noNamespace变量，是个布尔值，代表该模块是否使用命名空间。

然后返回一个对象local，里面定义了dispatch、commit方法和getters、state 属性。我们先看看里面的dispatch方法：

```js
const local = {
  dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
    const args = unifyObjectStyle(_type, _payload, _options)
    const { payload, options } = args
    let { type } = args
    if (!options || !options.root) {
      type = namespace + type
      if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
        console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
        return
      }
    }
    return store.dispatch(type, payload)
  }
}
```
如果该模块没有自己的命名空间，则local.dispatch直接使用store对象的dispatch方法。

如果该模块存在自己的命名空间，则定义local.dispatch为一个新的函数，函数可以接收三个参数：_type：即action的名称、_payload：载荷对象、_options：配置对象，这三个参数传入unifyObjectStyle函数执行，返回值赋给args。

我们看看unifyObjectStyle：

```js
function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }
  if (process.env.NODE_ENV !== 'production') {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }
  return { type, payload, options }
}
```
unifyObjectStyle函数的作用是对参数做归一化处理：如果第一个参数是对象且存在type属性，则传入的第二个参数作为options，第一个参数作为payload对象，type取第一个参数的type属性

开发环境下，如果type不是字符串，抛出错误。

最后返回出包含type, payload, options的对象。

回到local.dispatch方法，args拿到处理好的参数对象后，从中解构出type, payload, options变量。

```js
const { payload, options } = args
let { type } = args
if (!options || !options.root) {
  type = namespace + type
  if (process.env.NODE_ENV !== 'production' && !store._actions[type]) {
    console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
    return
  }
}
return store.dispatch(type, payload)
```

如果options不存在或options对象里没有root，则将type改为命名空间字符串和type的拼接。

开发环境下判断，如果store对象的存放actions的_actions对象里，没有名为type的action，就报错提示并直接返回。

最后返回出store对象的dispatch的执行结果，传入的是结合了命名空间的全局type，和payload载荷对象。

再来看local.commit，如果当前模块没有命名空间，直接用store.commit，否则定义local.commit方法：

```js
commit: noNamespace ? store.commit : (_type, _payload, _options) => {
  const args = unifyObjectStyle(_type, _payload, _options)
  const { payload, options } = args
  let { type } = args
  if (!options || !options.root) {
    type = namespace + type
    if (process.env.NODE_ENV !== 'production' && !store._mutations[type]) {
      console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
      return
    }
  }
  store.commit(type, payload, options)
}
```
commit是提交mutation的方法，定义的新函数接收三个参数：_type：mutation的名字，_payload：载荷对象，_options：配置对象。经过unifyObjectStyle函数处理成对象args。从args对象中解构出type, payload, options变量。

如果options不存在或options对象里没有root，就将type改写命名空间字符串和type的拼接。

开发环境下判断，如果store对象的存放mutation的_mutations对象里，没有名为type的mutation，就报错提示并直接返回。

最后返回出store对象的commit的执行结果，传入的是结合了命名空间的全局type，和payload载荷对象。

```js
Object.defineProperties(local, {
  getters: {
    get: noNamespace
      ? () => store.getters
      : () => makeLocalGetters(store, namespace)
  },
  state: {
    get: () => getNestedState(store.state, path)
  }
})
return local
```
用Object.defineProperties给local对象定义两个响应式属性：getters和state。

读取local.state时，会触发state的get方法，返回getNestedState的执行结果，getNestedState获取的是当前模块的state对象。

读取local.getters时，会触发getters的get方法，如果当前模块没有命名空间，则get方法执行直接返回store.getters，如果有命名空间，get方法执行返回makeLocalGetters函数的执行结果，传入的是store对象和当前的命名空间。

看看makeLocalGetters函数：

```js
function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      if (type.slice(0, splitPos) !== namespace) return
      const localType = type.slice(splitPos)
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }
  return store._makeLocalGettersCache[namespace]
}
```
store对象有个_makeLocalGettersCache属性，是一个对象专门存放生成的本地getters的缓存，根据namespace查看缓存对象中有没有，如果有就直接返回缓存值，如果没有就执行if语句块。

进入if语句块，首先定义一个getters的代理对象gettersProxy，然后获取命名空间字符串的长度splitPos。然后遍历store.getters对象，如果type字符串从开头截取到索引splitPos和命名空间字符串不相等，说明store.getters中该getter的type的前面的部分不匹配当前模块的命名空间，直接返回。

然后获取本地的type，即本地的getter名，赋给localType，在gettersProxy对象上定义localType只读属性，读取它时返回store.getters中全局type对应的getter。

遍历完store.getters后，gettersProxy就存放着属性名为localType的，属性值为对应的getter

将gettersProxy赋给store._makeLocalGettersCache[namespace]，_makeLocalGettersCache对象中，namespace就对应的属性值是一个对象，存放的是本地的getter名和对应的getter

综上，makeLocalGetters就是根据命名空间生成对应的本地getters对象，可以通过本地type访问全局type对应的getter。到此local对象填充完毕，makeLocalContext函数返回local对象

```js
const local = module.context = makeLocalContext(store, namespace, path)
```

回到installModule函数，现在makeLocalContext函数返回的local对象，赋给了变量local 和 module.context，这个local对象里有为当前模块设置局部化的dispatch、commit方法，和getter和state属性

然后调用Module的原型方法forEachMutation，将回调函数传入执行

```js
module.forEachMutation((mutation, key) => {
  var namespacedType = namespace + key;
  registerMutation(store, namespacedType, mutation, local);
})
```

```js
forEachMutation (fn) {
  if (this._rawModule.mutations) {
    forEachValue(this._rawModule.mutations, fn)
  }
}
```
forEachMutation 中，判断如果当前模块的配置对象传了mutations，就调用forEachValue遍历mutations对象，对每个键值对执行fn。

在fn中，首先将当前遍历的mutation所在的模块的命名空间字符串，拼接上，自己的key名，赋给namespacedType，它就是结合了namespace的mutation名。

调用 registerMutation 进行 mutation 方法的注册，我们看看registerMutation函数：

```js
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    handler.call(store, local.state, payload)
  })
}
```
结合`registerMutation(store, namespacedType, mutation, local);`来看

registerMutation函数可以接收4个参数：

1. store：store对象，即唯一的new Vuex.Store创建的store实例
2. type：即namespacedType，拼接了命名空间字符串的全局的mutation名
3. handler：mutation的属性值，即mutation对应的处理函数。
4. local ：local对象包含给当前模块设置的局部化的dispatch、commit方法，和getters、state属性

` var entry = store._mutations[type] || (store._mutations[type] = []);`

已知store实例的属性_mutations，是个存放mutation的数组，如果融合了命名空间的全局type在store._mutations对象中，找不到对应的mutation，那就将store._mutations[type]初始化为一个空数组，用来存放type对应的mutation。注意，store._mutations[type]和entry指向同一个内存空间。

```js
entry.push(payload => {
  handler.call(store, local.state, payload);
})
```
这是往store._mutations[type]数组推入一个mutation函数，它执行就是传入的handler的执行，handler执行时this指向store对象，注意，handler执行时接收的是local.state，局部化的state，和mutation函数接收的payload载荷对象。

于是遍历完当前模块的mutations对象，给每一个type都注册了对应的mutation函数，存放在store._mutations[type]数组中

接着，是action的注册

```js
module.forEachAction((action, key) => {
  const type = action.root ? key : namespace + key
  const handler = action.handler || action
  registerAction(store, type, handler, local)
})

forEachAction (fn) {
  if (this._rawModule.actions) {
    forEachValue(this._rawModule.actions, fn)
  }
}
```
forEachAction函数中，如果当前模块的配置对象传了actions，则调用forEachValue遍历actions，执行回调函数fn，fn接收action和对应的key。

在fn中，如果用户在action配置对象中传了root: true，说明他想在带命名空间的模块中注册全局的action，那么直接把key赋给type，否则还是空间字符串拼接key

用户配置actions时，可以写成对象形式，对象的handler属性传处理回调，也可以直接写成函数，因此优先获取第一个参数中的handler属性值，如果没有，直接取第一个参数。

调用registerAction进行action的注册。

```js
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}
```
首先判断store._actions这个对象是否存在type属性对应的数组，如果没有，则初始化为空数组，它存放type对应的action，向数组中推入一个包裹aciton的处理函数，即wrappedActionHandler。

wrappedActionHandler中：首先会调用用户设置的action的handler，调用结果赋给res缓存起来，handler执行时的this指向store对象，handler接收一个对象，它包含和store对象一样的方法和属性，称它为context对象，还接收wrappedActionHandler传入的payload。

然后判断res，如果不是promise实例，就将它包裹成resolve值为res的promise实例。最后返回res。(不考虑使用了devtools的情况)

接着，注册getter

```js
module.forEachGetter((getter, key) => {
  const namespacedType = namespace + key
  registerGetter(store, namespacedType, getter, local)
})

forEachGetter (fn) {
  if (this._rawModule.getters) {
    forEachValue(this._rawModule.getters, fn)
  }
}
```
forEachGetter函数中，如果当前模块的配置对象中传了getters，遍历它，执行回调函数fn。

在fn中，将当前模块的命名空间和key结合起来，赋给namespacedType，调用registerGetter注册getter

```js
function registerGetter (store, type, rawGetter, local) {
  if (store._wrappedGetters[type]) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}
```
registerGetter函数中，首先判断，如果store._wrappedGetters对象中，全局type对应的getter已经存在，就报错提示：你这个getter的key名字重复了。然后直接返回

如果type对应的getter不存在，那就往store._wrappedGetters对象中添加属性type和对应的wrappedGetter方法。它是rawGetter方法的封装。

rawGetter就是遍历getters对象时，传入回调的getter方法。rawGetter执行传入的是local对象的state、getters、和根state，根getters。

mutation、action、getter都注册完了，到了installModule的最后一步，遍历当前模块的子模块，进行子模块的安装：

```js
module.forEachChild((child, key) => {
  installModule(store, rootState, path.concat(key), child, hot)
})
forEachChild (fn) {
  forEachValue(this._children, fn)
}
```

当前的模块调用forEachChild方法，将回调函数传入，遍历当前模块的_children数组，它存放着它的子模块对象，执行fn，fn中递归调用installModule去安装子模块，传入的分别是：store对象，根state对象，子模块对象的path，子模块对象，和hot。

这样，子模块也得到了安装，即子模块的mutation、action、getter得到了注册。

## resetStoreVM

好了，我们现在来到实例化 Store 构造函数的核心三件事的最后一件：响应式化state
Vuex文档的原话：

>Vuex 的状态存储是响应式的。当 Vue 组件从 store 中读取 state 时，若 store 中的 state 发生变化，那么相应的组件也会相应地得到更新。

那Vuex是如何把state对象转成响应式的数据呢？原因在下面这句：

```js
resetStoreVM(this, state)
```

传入的this是store对象，state是根state，我们看看 resetStoreVM：

```js
function resetStoreVM (store, state, hot) {
  const oldVm = store._vm
  store.getters = {}
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    computed[key] = partial(fn, store)
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  if (store.strict) {
    enableStrictMode(store)
  }
  if (oldVm) {
    if (hot) {
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}
```

逐段分析：

```js
const oldVm = store._vm
store.getters = {}
store._makeLocalGettersCache = Object.create(null)
const wrappedGetters = store._wrappedGetters
const computed = {}
forEachValue(wrappedGetters, (fn, key) => {
  computed[key] = partial(fn, store)
  Object.defineProperty(store.getters, key, {
    get: () => store._vm[key],
    enumerable: true
  })
})
```
因为函数中要创建新的Vue实例赋给store._vm，创建前先将store._vm赋给 oldVm，保存一份旧值

给store对象上添加getters属性，值为一个空对象，添加_makeLocalGettersCache属性，值为一个空对象。定义变量wrappedGetters，指向store._wrappedGetters，里面存放的是已经注册好的getter方法。再定义一个computed变量，指向一个空对象。

遍历wrappedGetters对象，给computed对象添加方法，key为getter的名称，值为partial函数的返回值。

```js
function partial (fn, arg) {
  return () => {
    return fn(arg)
  }
}
```

注意传入 partial 的是getter函数和store对象，partial返回一个新的函数，函数执行实际执行的是传入的fn，即getter函数，getter函数接收store对象执行。

也就是，computed对象所添加的getter方法是被包裹了一层的，这么做的好处是，getter在函数外部执行，也能通过闭包引用了函数作用域中的store这个私有形参，这个store不会随着resetStoreVM执行结束而销毁。

```js
Object.defineProperty(store.getters, key, {
  get: () => store._vm[key],
  enumerable: true
})
```
遍历过程中，通过Object.defineProperty在store.getters添加getter属性，读取它的值时会执行它的get函数，返回store._vm[key]，即返回vue实例上的计算属性

store._vm上为什么会有xxx属性呢，原因是：

```js
const silent = Vue.config.silent
Vue.config.silent = true
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
Vue.config.silent = silent
```
首先获取Vue.config.silent的值。用户在使用Vue时，如果将它配置为真，是为了取消Vue所有的日志与警告。

将Vue.config.silent置为true，保证创建Vue实例时，不出现Vue的日志与警告，创建完Vue实例后，将它恢复为原来的值

实例化Vue，data选项传入$$state: state，$$state成了响应式属性，根state对象会被深度观测，即根state对象中的属性被转成响应式属性，并且我们知道Vue实例会直接代理Vue实例的_data对象，所以store._vm会代理store._vm._data中的数据，所以访问store._vm.$$state就相当于访问store._vm._data.$$state。

Store构造函数有state这个原型属性：

```js
get state () {
  return this._vm._data.$$state
}
```
我们知道所有组件实例的$store属性值，都指向同一个根store对象，读取this.$store.state的话，就是读取 store.state，会触发state的get函数，返回的是store._vm._data.$$state

即响应化了state后，访问store.state都是返回vm实例的data中的响应式数据

```js
store._vm = new Vue({
  data: {
    $$state: state
  },
  computed
})
```
因为computed对象存了getter方法，把computed对象作为computed选项传入new Vue后，被初始化为计算属性。

比如访问this.$store.getters.xxx时，即访问store.getters.xxx，我们已经给store.getters定义了响应式只读属性，所以会触发xxx属性的get函数，返回store._vm.xxx，为什么store._vm.xxx能获取到对应的getter方法呢，因为xxx已经被注册为Vue实例store._vm的计算属性了，所以store._vm.xxx可以访问到xxx的getter方法。

## Vuex.Store实例方法的实现
### commit

更改 store中的state的唯一的方法是提交 mutation，mutation都有一个字符串的type和一个handler回调函数，handler做的就是改变state，并且会接收state作为第一个参数，比如：
```js
const store = new Vuex.Store({
  state:{
    a:1
  }
  mutations:{
    change(state){
      state.a++
    }
  }
})
```
这其实就像一种事件的注册，当你调用store.commit触发"change"这个type类型的mutation时，会调用它的handler回调函数，注意，并不能直接调用mutation的handler

```js
store.commit('change')
```

commit是Store构造函数的原型方法，作用是提交mutation，我们看看它的实现：

```js
commit (_type, _payload, _options) {
  const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
  const mutation = { type, payload }
  const entry = this._mutations[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown mutation type: ${type}`)
    }
    return
  }
  this._withCommit(() => {
    entry.forEach(function commitIterator (handler) {
      handler(payload)
    })
  })
  this._subscribers.forEach(sub => sub(mutation, this.state))
  // ...
}
```
commit最多接收3个参数：

_type：要提交的mutation的type字符串，可以称它为mutation名
_payload：载荷(一般用户会传一个对象)
_options：配置对象，可以传root: true，它允许在命名空间模块里提交根的mutation

commit提交mutation的另一种方式是直接传一个包含type属性的对象：

```js
 store.commit({
   type:'change',
   amount: 10
 })
```
我们分段来看看commit的代码：

```js
const {type, payload, options} = unifyObjectStyle(_type, _payload, _options)
const mutation = { type, payload }
const entry = this._mutations[type]
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```
我们已经介绍过unifyObjectStyle函数，它对参数做统一化处理，从执行结果中解构出type, payload, options。

创建一个包含type和payload属性的对象，赋给mutation。获取store实例的_mutations对象中的type对应的mutation数组，赋给entry

如果entry不存在，在开发环境下，要打印警告：你传的type没有对应的mutation，然后直接返回

```js
if (!entry) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[vuex] unknown mutation type: ${type}`)
  }
  return
}
```
如果 entry不存在，说明这个mutation没有注册过，所以你无法调用 store.commit 去提交这个mutation，会给你一个报警提示：未知的mutation type，然后直接返回

接下来，继续看：
```js
this._withCommit(() => {
  entry.forEach(function commitIterator (handler) {
    handler(payload)
  })
})
```
我们前面分析过 _withCommit做的事是把_committing先置为true，然后执行回调函数，执行完后再把_committing 恢复到原来的值。

我们先来看回调做了什么事：遍历数组entry，即this._mutations[type]数组，将数组每一个handler执行，传入用户调用commit时传入的payload。也就是，将type对应的handler(不管有几个)都执行一遍。

接下来：
```js
this._subscribers.forEach(sub => sub(mutation, this.state))
```

this._subscribers的this指向 store对象，_subscribers存放的是所有对mutation的订阅者
这是哪来的呢？？？其实我们看Vuex文档可知，Store有一个原型方法subscribe，虽然你很少用到它，它的作用是订阅mutation，然后handler会在mutation完成后调用，通常这个方法是用于插件，其实没啥必要看，既然都写到这了，看吧
```js
subscribe (fn) {
  return genericSubscribe(fn, this._subscribers)
}
function genericSubscribe (fn, subs) {
  if (subs.indexOf(fn) < 0) {
    subs.push(fn);
  }
  return function () {
    var i = subs.indexOf(fn);
    if (i > -1) {
      subs.splice(i, 1);
    }
  }
}
```
我们可以看到，subscribe接收一个回调函数fn，返回genericSubscribe的执行值，传入的是fn和存放所有对mutation的订阅者
genericSubscribe做了什么事，首先，如果subs数组中没有这个fn，就把它push进取
genericSubscribe执行返回一个函数，函数中会找到fn在subs数组中位置，并把fn从中删除。

。。。有点懵了
`this._subscribers.forEach(sub => sub(mutation, this.state))`
现在遍历 mutation 的订阅者数组，执行回调，sub就是你subscribe的时候自己写的回调fn，fn执行传入mutation和经过mutation后的state。

### dispatch

dispatch是Store的原型方法，作用是触发action。action通常进行异步操作，store.dispatch就用来处理action的处理函数执行返回的promise，并且store.dispatch执行也是返回promise。

```js
actions:{
  actionA({ commit }){
    return new Promise((resolve,reject)=>{
      // 异步操作
    })
  }
}
```
用store.dispatch分发action你可以这么写
```js
store.dispatch('actionA').then(()=>{
  // ....
})
```
好的，现在看看store.dispatch的实现，比较长，分段看吧：
```js
dispatch (_type, _payload) {
  const { type, payload } = unifyObjectStyle(_type, _payload)
  const action = { type, payload }
  const entry = this._actions[type]
  if (!entry) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] unknown action type: ${type}`)
    }
    return
  }
  // ....
}
```
调用unifyObjectStyle函数对dispatch函数接收的参数做归一化。

然后变量type, payload取到归一化后的type, payload，把他们放进一个对象，然后赋给变量action

定义entry，指向this._actions[type]，它是存放type对应的action方法的数组。

如果entry不存在，说明该type的action还没注册，报警提示；未知的action type，然后直接返回

接着继续：
```js
try {
  this._actionSubscribers
    .filter(sub => sub.before)
    .forEach(sub => sub.before(action, this.state))
} catch (e) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[vuex] error in before action subscribers: `)
    console.error(e)
  }
}
```
action的订阅函数。。。算了，这里我不想分析了，还没用过它

再接下来：
```js
const result = entry.length > 1
  ? Promise.all(entry.map(handler => handler(payload)))
  : entry[0](payload)
return result.then(res => {
  // 这是。。。先不太了解，做了一个try catch
  return res
})
```
如果entry数组的长度>1，说明type对应的action的处理函数有多个(同名action传了多个)，可能每个回调就管控一个异步操作，我们不能单纯地遍历执行action，而是要把每个action的执行结果(promise对象)放到一个数组里，传给Promise.all，给它管控。

所以将entry数组里每个handler执行，传入dispatch传入的payload，handler的执行结果覆盖数组的每项，然后map返回的是一个数组，传给Promise.all执行，执行返回值赋给result

如果entry数组只有1个元素，就将它这个handler函数传入payload执行，执行返回值赋给result

我们知道registerAction函数中将action的处理函数包裹成wrappedActionHandler函数，推入entry数组，它返回的一定是promise实例，所以result一定是promise实例，它调用then，做一些处理后，返回res。

## 辅助函数

### mapState

>当一个组件需要获取多个state时候，将这些state都声明为computed会有些重复和冗余。我们可以使用 mapState 辅助函数帮助我们生成计算属性
我们看看mapState函数的实现：
```js
  var mapState = normalizeNamespace(function (namespace, states) {
    var res = {};
    normalizeMap(states).forEach(function (ref) {
      // ...
    });
    return res
  });
```
可以看到它是normalizeNamespace函数的返回值，normalizeNamespace做了什么事情：
```js
function normalizeNamespace (fn) {
  return function (namespace, map) {
    if (typeof namespace !== 'string') {
      map = namespace;
      namespace = '';
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      namespace += '/';
    }
    return fn(namespace, map)
  }
}
```
可以看到normalizeNamespace接收一个函数fn，返回出一个新的函数，因此mapState就指向这个新函数，它接收两个参数：namespace和map。
做了什么事情？首先判断传入的namespace，如果不是字符串，就把传入的第一个参数作为map，namespace赋值为''。满足是字符串，但最后一个字符不是 / ，要给namespace末尾加上 / 
最后返回 fn(namespace, map)，也就是说mapState执行其实返回了fn的执行结果
我们具体看看传入的fn是怎么样的：
```js
function (namespace, states) {
  var res = {};
  normalizeMap(states).forEach(function (ref) {
    // ...
  });
  return res
}
```
可以看到这个fn执行返回res对象，normalizeMap(states)遍历的过程中肯定往res对象添加属性了，中间具体做了什么，我们看看normalizeMap(states)，返回了什么内容，下面是normalizeMap的实现
```js
function normalizeMap (map) {
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}
```
normalizeMap接收states，也就是mapState接收的第二个参数（对象形式）
normalizeMap中，首先判断map是否为数组，如果是，将数组每项key 转成 {key:key, val:key}这种结构
如果不是，Object.keys获取map对象的所有自有属性组成的数组，然后将每一项key转成 {key, val:map[key]}
normalizeMap其实就是做的一种map对象的形式上的整理

```js
normalizeMap(states).forEach(function (ref) {
  var key = ref.key;
  var val = ref.val;

  res[key] = function mappedState () {
    var state = this.$store.state;
    var getters = this.$store.getters;
    if (namespace) {
      var module = getModuleByNamespace(this.$store, 'mapState', namespace);
      if (!module) {
        return
      }
      state = module.context.state;
      getters = module.context.getters;
    }
    return typeof val === 'function'
      ? val.call(this, state, getters)
      : state[val]
  };
  // mark vuex getter for devtools
  res[key].vuex = true;
});
```
现在对normalizeMap(states)进行遍历，key拿到元素项的key，val拿到元素项的val，res是一个空对象，现在要在res对象中添加方法，属性值为key，方法为mappedState函数。
mappedState函数中，state指向store对象的state对象，getters指向store对象的getters对象。接下来判断namespace是否存在，也就是有没有给mapState传字符串，命名空间字符串。如果有，调用getModuleByNamespace获取到它对应的模块对象，赋给module，我们粗略看看getModuleByNamespace的实现：

```js
var module = getModuleByNamespace(this.$store, 'mapState', namespace);
// 
function getModuleByNamespace (store, helper, namespace) {
    var module = store._modulesNamespaceMap[namespace];
    if (!module) {
      console.error(("[vuex] module namespace not found in " + helper + "(): " + namespace));
    }
    return module
  }
```
你可以看到，getModuleByNamespace接收三个参数：store对象，'mapState'这个辅助函数的函数名，namespace命名空间字符串
首先会去store._modulesNamespaceMap这个存放命名空间对应的模块的对象，去找出namespace对应的module，然后返回模块
如果module不存在，报错提示：你要找的namespace这个命名空间在_modulesNamespaceMap中找不到对应的模块

我们在实例化Store的时候，已经把所有的模块都以 namespace 为key的形式添加到了store._modulesNamespaceMap对象中。

```js
if (namespace) {
  var module = getModuleByNamespace(this.$store, 'mapState', namespace);
  if (!module) {
    return
  }
  state = module.context.state;
  getters = module.context.getters;
}
```
判断module不存在就直接返回，state赋值为module.context.state，这个又是什么，其实这是带命名空间模块的state，getters拿到带命名空间模块的getters

```js
return typeof val === 'function'
        ? val.call(this, state, getters)
        : state[val]
```
val是什么，它是normalizeMap(states)中当前遍历的项的val值，如果它是函数（说明你传的map是一个对象，属性值是函数形式的），直接调用，执行时this指向当前Vue实例，传入state，getters。如果不是函数（说明你传的map是字符串组成的数组形式），返回state[val]，即state对象中对应的state。。。

综上，mapState函数的第一个参数可以接收，模块的空间命名字符串，可以不传，然后是一个map对象，mapState执行返回一个对象res，里面存放了一个个键值对，key是你在map中命名的属性，属性值一个函数，函数执行返回state对象中对应state值

因为mapState执行返回一个对象，你可以这么使用mapState

比如
```js
 computed: mapState({
    count: state => state.count,
    countAlias: 'count',
    // 传字符串参数 'count' 等同于 `state => state.count`    
    countPlusLocalState (state) {
      return state.count + this.localCount
    }
    // 为了能够使用 `this` 获取局部状态，必须使用常规函数
  })
```
我们知道mapState传入的这个的对象，就是map对象，它会经过normalizeMap的处理，转成数组，每个元素是一个对象{key,val}，然后遍历这个数组，往待返回的对象res里添加方法，方法名为key，如果val是一个函数就直接返回val的执行结果，如果不是，就返回state中val的值，比如上面的 state.count
mapState执行返回出的对象，作为computed选项，那么count，countAlias，countPlusLocalState都成为了计算属性

给mapState传入的map对象还可以是数组，比如这么写：
```js
computed: mapState([
  'count',// 映射 this.count 为 store.state.count
  'xxxxx'
])
```
mapState会将数组的每项转成 {'count':'count'} 这样的形式，遍历数组，往res对象里添加方法，方法名为'count'，方法本身执行返回 store.state.count

因为mapState返回的是一个对象，并且每个键值对拿出来就是一个computed，我们可以用对象展开运算符 将它混入到计算属性中，这样就不影响你写别的computed
```js
computed: {
  localComputed () { /* ... */ },
  ...mapState({
    // ...
  })
}
```
那带命名空间的模块里的state呢，怎么通过mapState获取，可以这么写
```js
computed: {
  ...mapState({
    a: state => state.some.nested.module.a,
    b: state => state.some.nested.module.b
  })
},
```
使用mapState绑定带命名空间的模块时，这么写比较繁琐
你可以将模块的空间名称字符串作为第一个参数传入mapState，这样所有的绑定会自动将该模块作为上下文
```js
computed: {
  ...mapState('some/nested/module', {
    a: state => state.a,
    b: state => state.b
  })
},
```
由前面的源码我们知道，mapState会根据namespace获取对应的模块，然后函数中的state就不再取根state，取module.context.state，也就是这个模块对应的state（当地化的意思），剩余的逻辑和前面一样，将第二个参数map对象，mapState返回出对象，key为你写的a，对应的函数，函数执行返回state => state.a的执行结果，只是现在的state并不是根state对象，而是当地化的state

他妈的，终于搞懂了mapState内部实现

### mapGetters
和mapState的实现很像
```js
  var mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  normalizeMap(getters).forEach(({ key, val }) => {
    val = namespace + val
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (process.env.NODE_ENV !== 'production' && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val]
    }
    res[key].vuex = true
  })
  return res
})
```
我们这直接讲了，不分段了。mapGetters接收namespace（可选）和getters（一个map对象），mapGetters执行也就是normalizeNamespace传入的函数执行，准备一个待返回的对象res，将传入的map对象经过normalizeMap处理成数组，map对象有两种形式：

1. ['getter1', 'getter2']   数组项就是store里getter的真实名字
2. { myGetter1: 'getter1'}  你想将getter属性取另一个名字，就这样使用对象形式

key取数组项里的key，val取它的val，如果存在命名空间的话，val = namespace + val;
往res对象中添加键值对，属性值为key，属性值为函数，函数返回store里的getters中val对应的getter，最后mapGetters执行返回出这个res对象

所以...mapGetter()出来的一个个计算属性，他们的函数返回值是store.getters对应的属性值


### mapActions
```js
  var mapActions = normalizeNamespace((namespace, actions) => {
    const res = {}
    normalizeMap(actions).forEach(({ key, val }) => {
      res[key] = function mappedAction (...args) {
        // get dispatch function from store
        let dispatch = this.$store.dispatch
        if (namespace) {
          const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
          if (!module) return
          dispatch = module.context.dispatch
        }
        return typeof val === 'function'
          ? val.apply(this, [dispatch].concat(args))
          : dispatch.apply(this.$store, [val].concat(args))
      }
    })
    return res
  })
```
和前面俩一样，mapActions执行也就是normalizeNamespace的参数回调执行，回调函数中，准备一个空对象res，
normalizeMap会将mapActions接收的action对象格式化成一个数组，遍历数组，往res对象中添加键值对，key: 一个函数
这个函数所接收的参数组成了数组args，这个函数中，先缓存了this.$store.dispatch的方法，如果namespace存在，说明mapActions时传入的第一个参数是带命名空间的字符串，根据namespace获取对应的模块，获取不到就直接返回，然后把dispatch变量更新为所找到的模块对应的dispatch方法（local的，当地化后的）
最后判断val是否是一个函数，是则直接调用，this指向当前Vue实例，如果是一个函数，（这里没太搞懂，但可以肯定的是我们经常不这么写）如果不是一个函数，则调用dispatch方法，this指向store对象，传入action的名字字符串，即val，和作为method接收的参数args。

比如，你会这么写：
```js
methods:{
  ...mapActions(['action1', 'action2']),

  ...mapActions({
    myAction3: 'action3'
  }),
}
```
第一个mapActions执行返回的对象中，{ 'action1': 函数1, 'action2': 函数2 }
这个对象被展开后混入methods中成为method，那么函数1作为method，它接收的参数，参数数组args
函数1里面做的事情就是 this.$store.dispatch('action1', ...args)
就像下面这样
```js
action1(...args){
  this.$store.dispatch('action1', ...args)
}
```
第二个mapActions执行返回的对象，会像这样：{ 'myAction3' : 函数3 }
这个对象被展开后混入methods，成为method，它接收的参数放到一个数组里args
```js
myAction3(...args){
  this.$store.dispatch('action3', ...args)
}
```
所以函数3里做的事情就是 this.$store.dispatch('action3', ...args)


### mapMutations

```js
var mapMutations = normalizeNamespace((namespace, mutations) => {
    const res = {}
    normalizeMap(mutations).forEach(({ key, val }) => {
      res[key] = function mappedMutation (...args) {
        let commit = this.$store.commit
        if (namespace) {
          const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
          if (!module) return
          commit = module.context.commit
        }
        return typeof val === 'function'
          ? val.apply(this, [commit].concat(args))
          : commit.apply(this.$store, [val].concat(args))
      }
    })
    return res
  })
```
同样的，mapMutations执行相当于(namespace, mutations) => {....这个回调执行，返回出一个对象res
比如你这么使用：
```js
methods: {
    ...mapMutations(['muta1',  'muta2' ]),

    ...mapMutations({ myMuta3: 'muta3' })
  }
```
比如第一个，返回的res对象就像这样: { 'muta1': 函数1 ,  'muta2': 函数2  }
muta1就成了method名，method值为函数1，那函数1接收的参数数组为args
函数1其实就是源码中的mappedMutation函数，它做了什么：获取this.$store.commit，如果传来模块命名空间字符串，就获取模块本地化的commit，然后 执行 commit.apply(this.$store, [val].concat(args))
也就是 `this.$store.commit('muta1', ...args)`

第二个也类似，变成这样的method
```js
methods:{
  myMuta3(...args){
    this.$store.commit('muta3' , ...args)
  }
}
```

现在好像 Vuex源码基本分析完了。。
